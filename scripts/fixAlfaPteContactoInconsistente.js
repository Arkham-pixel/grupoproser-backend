/**
 * Corrige PTE CONTACTO inconsistente (con inspección/liquidación/docs)
 * en Mongo + columna AI del Excel SharePoint.
 *
 *   node scripts/fixAlfaPteContactoInconsistente.js --dry-run
 *   node scripts/fixAlfaPteContactoInconsistente.js --apply
 */
import '../config/loadEnv.js';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { ALFA_EXCEL_SHEET_NAME } from '../config/alfaExcelOwnershipMap.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import { selectAlfaExcelFromSharePointFolder } from '../services/alfaExcelSharePointImportService.js';
import {
  parseAlfaExcelBuffer,
  matchAlfaCaseForExcelRow,
} from '../services/alfaExcelImportService.js';
import {
  homologarEstadoGestionAlfa,
  homologarEstadoSiniestroAlfa,
  sincronizarGestionConCierreSiniestroAlfa,
  estadoGestionAlfaParaSharePoint,
} from '../config/alfaExcelStatuses.js';
import {
  resetMicrosoftGraphClient,
  getAccessToken,
  resolveDriveContext,
  getItemMetadata,
  downloadDriveItemBuffer,
  createWorkbookSession,
  closeWorkbookSession,
  updateWorkbookRange,
} from '../services/microsoftGraphService.js';
import { normalizeExcelHeader } from '../utils/alfaExcelNormalize.js';

const DRY = process.argv.includes('--dry-run') || !process.argv.includes('--apply');

function log(event, payload = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...payload }));
}

function colLetter(n) {
  let x = Number(n);
  let s = '';
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function headerCellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
  }
  return String(value);
}

function cellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
  }
  return String(value);
}

function resolveCol(headerRow, aliases) {
  const norms = aliases.map((h) => normalizeExcelHeader(h));
  const maxCol = Math.max(60, headerRow.cellCount || 0);
  for (let c = 1; c <= maxCol; c += 1) {
    const norm = normalizeExcelHeader(headerCellText(headerRow.getCell(c).value));
    if (norm && norms.includes(norm)) return c;
  }
  return null;
}

function hasDate(v) {
  if (v == null || v === '') return false;
  const d = v instanceof Date ? v : new Date(v);
  return !Number.isNaN(d.getTime());
}

/**
 * Si está en PTE CONTACTO pero ya hay avance operativo, deriva gestión real.
 * Sin avance → EN GESTIÓN (no dejar PTE CONTACTO huérfano/incorrecto).
 */
export function corregirGestionPteContacto(caso = {}, excelDates = {}) {
  const g = homologarEstadoGestionAlfa(caso.estadoGestion);
  if (g !== 'PTE CONTACTO') return g;

  const s = homologarEstadoSiniestroAlfa(caso.estado, caso);
  const fi = hasDate(caso.fechaInspeccion) || hasDate(excelDates.fechaInspeccion);
  const fl = hasDate(caso.fechaLiquidado) || hasDate(excelDates.fechaLiquidado);
  const fd = hasDate(caso.fechaUltimoDocumento) || hasDate(excelDates.fechaUltimoDocumento);
  const liquidador = caso.liquidador && typeof caso.liquidador === 'object';
  const valorLiq = Number(caso.valorLiquidado) > 0;

  let next = 'EN GESTIÓN';
  if (
    fl ||
    valorLiq ||
    liquidador ||
    s === 'OBJETADO' ||
    s === 'PROCESO DE PAGO' ||
    s === 'PENDIENTE ACEPTACION CIFRAS' ||
    s === 'PAGADO'
  ) {
    next = 'LIQUIDADO';
  } else if (fi || s === 'INSPECCIONADO PENDIENTE' || s === 'DESISTIDO' || s === 'CERRADO') {
    next = 'INSPECCIONADO';
  } else if (fd) {
    next = 'SOLICITUD DTOS';
  }

  return sincronizarGestionConCierreSiniestroAlfa(s, next) || next;
}

resetMicrosoftGraphClient();
await getAccessToken();
const cfg = getAlfaExcelSharePointImportConfig();
const ctx = await resolveDriveContext();
const sel = await selectAlfaExcelFromSharePointFolder(cfg.rootPath, cfg.fileName);
const meta = await getItemMetadata(sel.selected.itemId);
const driveId = meta.parentReference?.driveId || ctx.driveId;
const itemId = meta.id;

const dl = await downloadDriveItemBuffer({ driveId, itemId });
const sourceBuffer = dl.buffer || dl;
log('DOWNLOADED', { file: meta.name, bytes: sourceBuffer.length, dryRun: DRY });

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URI_DIRECT;
if (!uri) throw new Error('MONGODB_URI_MISSING');
await mongoose.connect(uri);

const casos = await SegurosAlfaCaso.find({})
  .select(
    'consecutivo siniestro identificacion estado estadoGestion liquidador valorLiquidado fechaInspeccion fechaUltimoDocumento fechaLiquidado fechaAceptacionLiquidacion'
  )
  .lean();

const parsed = parseAlfaExcelBuffer(sourceBuffer);
const excelRows = parsed.rows || [];

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(sourceBuffer);
const ws =
  wb.getWorksheet(ALFA_EXCEL_SHEET_NAME) ||
  wb.worksheets.find((w) => String(w.name).trim().toUpperCase() === 'BD') ||
  wb.worksheets[0];
if (!ws) throw new Error('NO_SHEET_BD');

const headerRow = ws.getRow(1);
const gestionCol = resolveCol(headerRow, ['ESTADO GESTION', 'ESTADO DE GESTION', 'ESTADO G']);
const inspCol = resolveCol(headerRow, ['FECHA INSPECCION', 'FECHA INSPECCIÓN']);
const docCol = resolveCol(headerRow, ['FECHA ULTIMO DOCUMENTO', 'FECHA ÚLTIMO DOCUMENTO']);
const liqCol = resolveCol(headerRow, ['FECHA LIQUIDADO', 'FECHA LIQUIDACION', 'FECHA LIQUIDACIÓN']);
if (!gestionCol) throw new Error('ESTADO_GESTION_HEADER_MISSING');

const stats = {
  excelPteFixed: 0,
  mongoPteFixed: 0,
  samples: [],
};

const mongoPatches = new Map();
const excelCellUpdates = [];
const touchedIds = new Set();
const gLetter = colLetter(gestionCol);

for (const excelRow of excelRows) {
  const r = Number(excelRow.rowNumber);
  if (!r || r < 2) continue;
  const sheetRow = ws.getRow(r);
  const gRaw = cellText(sheetRow.getCell(gestionCol).value).trim();
  if (homologarEstadoGestionAlfa(gRaw) !== 'PTE CONTACTO') continue;

  const excelDates = {
    fechaInspeccion: inspCol ? sheetRow.getCell(inspCol).value : null,
    fechaUltimoDocumento: docCol ? sheetRow.getCell(docCol).value : null,
    fechaLiquidado: liqCol ? sheetRow.getCell(liqCol).value : null,
  };

  let caso = null;
  try {
    const match = matchAlfaCaseForExcelRow(excelRow.payload || excelRow, casos);
    if (match?.actionHint === 'MATCH' && match.cases?.length === 1) caso = match.cases[0];
  } catch {
    /* ignore */
  }

  const siniestroCol = resolveCol(headerRow, ['ESTADO SINIESTRO', 'ESTADO']);
  const base = caso || {
    estadoGestion: gRaw,
    estado: siniestroCol ? cellText(sheetRow.getCell(siniestroCol).value) : 'PENDIENTE',
  };
  let nextG = corregirGestionPteContacto(base, excelDates);
  if (nextG === 'PTE CONTACTO') nextG = 'EN GESTIÓN';

  stats.excelPteFixed += 1;
  excelCellUpdates.push({
    row: r,
    address: `${gLetter}${r}`,
    from: gRaw,
    to: estadoGestionAlfaParaSharePoint(nextG),
  });
  if (stats.samples.length < 40) {
    stats.samples.push({
      row: r,
      consecutivo: caso?.consecutivo || null,
      identificacion: caso?.identificacion || excelRow.payload?.identificacion,
      from: gRaw,
      to: nextG,
      dates: {
        insp: Boolean(hasDate(excelDates.fechaInspeccion) || hasDate(caso?.fechaInspeccion)),
        doc: Boolean(hasDate(excelDates.fechaUltimoDocumento) || hasDate(caso?.fechaUltimoDocumento)),
        liq: Boolean(hasDate(excelDates.fechaLiquidado) || hasDate(caso?.fechaLiquidado)),
      },
    });
  }
  if (caso) {
    mongoPatches.set(String(caso._id), nextG);
    touchedIds.add(String(caso._id));
  }
}

// Mongo PTE CONTACTO restantes
for (const caso of casos) {
  const g = homologarEstadoGestionAlfa(caso.estadoGestion);
  if (g !== 'PTE CONTACTO') continue;
  if (touchedIds.has(String(caso._id))) continue;
  const nextG = corregirGestionPteContacto(caso);
  const target = nextG === 'PTE CONTACTO' ? 'EN GESTIÓN' : nextG;
  mongoPatches.set(String(caso._id), target);
  if (stats.samples.length < 50) {
    stats.samples.push({
      consecutivo: caso.consecutivo,
      identificacion: caso.identificacion,
      from: caso.estadoGestion,
      to: target,
      reason: 'mongo-orphan-pte',
    });
  }
}

if (!DRY) {
  for (const [id, nextG] of mongoPatches.entries()) {
    await SegurosAlfaCaso.updateOne({ _id: id }, { $set: { estadoGestion: nextG } });
    stats.mongoPteFixed += 1;
  }

  if (excelCellUpdates.length) {
    let sessionId = null;
    let ok = 0;
    let fail = 0;
    try {
      const session = await createWorkbookSession({ driveId, itemId, persistChanges: true });
      sessionId = session?.id;
      if (!sessionId) throw new Error('NO_WORKBOOK_SESSION');
      log('SESSION_OK', { sessionId: String(sessionId).slice(0, 12) });
      for (const u of excelCellUpdates) {
        try {
          await updateWorkbookRange({
            driveId,
            itemId,
            worksheetName: ws.name,
            address: u.address,
            values: [[u.to]],
            sessionId,
          });
          ok += 1;
        } catch (err) {
          fail += 1;
          log('CELL_FAIL', { address: u.address, error: err.message || String(err) });
        }
      }
    } finally {
      if (sessionId) {
        await closeWorkbookSession({ driveId, itemId, sessionId });
      }
    }
    log('EXCEL_CELLS', { ok, fail, total: excelCellUpdates.length });
  }
}

log('FIX_DONE', {
  dryRun: DRY,
  excelPteFixed: stats.excelPteFixed,
  mongoPatches: mongoPatches.size,
  mongoUpdated: stats.mongoPteFixed,
  samples: stats.samples,
  hint: DRY
    ? 'Usa --apply para escribir (celdas Graph; puedes dejar Excel abierto)'
    : 'Mongo + Excel actualizados',
});

await mongoose.disconnect();
process.exit(0);
