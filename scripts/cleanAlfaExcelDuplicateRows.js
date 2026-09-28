/**
 * Elimina filas Excel duplicadas (misma ID + misma dirección/crédito) cuando
 * ARNALD solo tiene 1 caso. Conserva la fila "mejor" (póliza real, montos, estado).
 *
 * Dry-run: node scripts/cleanAlfaExcelDuplicateRows.js
 * Apply:   node scripts/cleanAlfaExcelDuplicateRows.js --apply
 */
import '../config/loadEnv.js';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import {
  downloadDriveItemBuffer,
  getItemMetadata,
  replaceDriveItemContentBuffer,
  createWorkbookSession,
  closeWorkbookSession,
  deleteWorkbookRangeRows,
} from '../services/microsoftGraphService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';
import { isPolicyPlaceholder } from '../utils/alfaExcelNormalize.js';
import { ALFA_EXCEL_SHEET_NAME } from '../config/alfaExcelOwnershipMap.js';

const APPLY = process.argv.includes('--apply');

function normId(v) {
  return String(v ?? '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
}

function normDir(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normCred(v) {
  return String(v ?? '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
}

function scoreRow(p = {}) {
  let s = 0;
  if (p.numeroPoliza && !isPolicyPlaceholder(p.numeroPoliza)) s += 50;
  if (Number(p.valorReclamado) > 0) s += 20;
  if (Number(p.valorLiquidado) > 0) s += 20;
  if (Number(p.reserva) > 0) s += 10;
  const est = String(p.estado || '').toUpperCase();
  if (est.includes('PAGO') || est.includes('LIQUID') || est.includes('ACEPT')) s += 30;
  if (est.includes('OBJET') || est.includes('DESIST') || est.includes('CERRAD')) s += 15;
  if (p.ajustador) s += 5;
  if (p.fechaInspeccion) s += 5;
  // Preferir fila más antigua en empate (menos probable que sea append)
  return s;
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
});

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
});
if (!src?.itemId) {
  console.error('No Excel source');
  process.exit(1);
}
if (isAlfaExcelFinalProtectedName(src.fileName)) {
  console.error('ABORT Final protected', src.fileName);
  process.exit(1);
}

const downloaded = await downloadDriveItemBuffer({
  driveId: src.driveId,
  itemId: src.itemId,
});
const buffer = downloaded.buffer || downloaded;
const parsed = parseAlfaExcelBuffer(buffer);
const excelRows = parsed.rows || [];

const mongo = await SegurosAlfaCaso.find({ excluidoBaseAlfa: { $ne: true } })
  .select('identificacion')
  .lean();
const mongoCountById = new Map();
for (const c of mongo) {
  const id = normId(c.identificacion);
  if (!id) continue;
  mongoCountById.set(id, (mongoCountById.get(id) || 0) + 1);
}

const byId = new Map();
for (const r of excelRows) {
  const id = normId(r.payload?.identificacion);
  if (!id) continue;
  if (!byId.has(id)) byId.set(id, []);
  byId.get(id).push(r);
}

const toDelete = [];
const plan = [];

for (const [id, rows] of byId.entries()) {
  const mongoN = mongoCountById.get(id) || 0;
  if (rows.length <= 1 || rows.length <= mongoN) continue;

  // Agrupar por dirección suelta; si no hay dir, por crédito
  const groups = new Map();
  for (const r of rows) {
    const dir = normDir(r.payload?.direccionPredio);
    const cred = normCred(r.payload?.numeroCredito);
    const key = dir || (cred ? `CRED:${cred}` : `ROW:${r.rowNumber}`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  for (const [gKey, gRows] of groups.entries()) {
    if (gRows.length <= 1) continue;
    const ranked = [...gRows].sort((a, b) => {
      const ds = scoreRow(b.payload) - scoreRow(a.payload);
      if (ds !== 0) return ds;
      return a.rowNumber - b.rowNumber;
    });
    const keep = ranked[0];
    const drop = ranked.slice(1);
    plan.push({
      id,
      group: gKey.slice(0, 50),
      keep: keep.rowNumber,
      keepScore: scoreRow(keep.payload),
      drop: drop.map((d) => ({ row: d.rowNumber, score: scoreRow(d.payload) })),
    });
    for (const d of drop) toDelete.push(d.rowNumber);
  }
}

toDelete.sort((a, b) => b - a); // borrar de abajo hacia arriba

console.log(
  JSON.stringify(
    {
      dryRun: !APPLY,
      fileName: src.fileName,
      excelRows: excelRows.length,
      mongoActivos: mongo.length,
      grupos: plan.length,
      rowsToDelete: toDelete,
      plan,
    },
    null,
    2
  )
);

if (!APPLY) {
  console.log('Dry-run OK. Re-ejecutar con --apply para borrar filas.');
  await mongoose.disconnect();
  process.exit(0);
}

if (!toDelete.length) {
  console.log('Nada que borrar.');
  await mongoose.disconnect();
  process.exit(0);
}

let lastErr = null;
for (let attempt = 1; attempt <= 6; attempt += 1) {
  try {
    const meta = await getItemMetadata(src.itemId);
    const dl = await downloadDriveItemBuffer({
      driveId: src.driveId,
      itemId: src.itemId,
    });
    const buf = dl.buffer || dl;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws =
      wb.getWorksheet(parsed.sheetName || ALFA_EXCEL_SHEET_NAME) ||
      wb.worksheets.find((w) => String(w.name).toUpperCase() === 'BD') ||
      wb.worksheets[0];
    if (!ws) throw new Error('EXCEL_SHEET_NOT_FOUND');

    for (const rowNum of toDelete) {
      ws.spliceRows(rowNum, 1);
    }

    // AutoFilter al nuevo rango
    const headerRow = ws.getRow(1);
    let lastCol = 1;
    headerRow.eachCell({ includeEmpty: false }, (_c, col) => {
      if (col > lastCol) lastCol = col;
    });
    let lastData = 1;
    ws.eachRow({ includeEmpty: false }, (_r, n) => {
      if (n > lastData) lastData = n;
    });
    const colLetter = (n) => {
      let s = '';
      let x = n;
      while (x > 0) {
        const m = (x - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        x = Math.floor((x - 1) / 26);
      }
      return s;
    };
    ws.autoFilter = `A1:${colLetter(lastCol)}${Math.max(2, lastData)}`;

    const outBuf = Buffer.from(await wb.xlsx.writeBuffer());
    const uploaded = await replaceDriveItemContentBuffer({
      driveId: src.driveId,
      itemId: src.itemId,
      buffer: outBuf,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ifMatch: meta.eTag || undefined,
    });

    src.eTag = uploaded?.eTag || meta.eTag;
    src.lastArnaldWrittenEtag = src.eTag;
    await src.save();

    console.log(
      JSON.stringify({
        applied: true,
        mode: 'replace-content',
        deleted: toDelete.length,
        excelRowsAfterApprox: excelRows.length - toDelete.length,
        eTag: src.eTag,
      })
    );
    lastErr = null;
    break;
  } catch (err) {
    lastErr = err;
    console.log('retry-replace', attempt, err.code || err.message);

    // Si está locked (archivo abierto), borrar filas vía sesión Graph.
    if (err.code === 'EXCEL_SOURCE_LOCKED' || err.status === 423) {
      try {
        const sheetName = parsed.sheetName || ALFA_EXCEL_SHEET_NAME || 'BD';
        const session = await createWorkbookSession({
          driveId: src.driveId,
          itemId: src.itemId,
          persistChanges: true,
        });
        const sessionId = session?.id;
        // Borrar de abajo hacia arriba para no desplazar índices pendientes.
        for (const rowNum of toDelete) {
          await deleteWorkbookRangeRows({
            driveId: src.driveId,
            itemId: src.itemId,
            worksheetName: sheetName,
            address: `${rowNum}:${rowNum}`,
            sessionId,
            shift: 'Up',
          });
          console.log('deleted-row-session', rowNum);
        }
        await closeWorkbookSession({
          driveId: src.driveId,
          itemId: src.itemId,
          sessionId,
        });
        console.log(
          JSON.stringify({
            applied: true,
            mode: 'workbook-session-delete',
            deleted: toDelete.length,
            excelRowsAfterApprox: excelRows.length - toDelete.length,
          })
        );
        lastErr = null;
        break;
      } catch (sessionErr) {
        console.log('session-delete-fail', sessionErr.code || sessionErr.message);
        lastErr = sessionErr;
      }
    }

    if (attempt === 6) throw lastErr || err;
    await new Promise((r) => setTimeout(r, 2500 * attempt));
  }
}

if (lastErr) throw lastErr;
await mongoose.disconnect();
