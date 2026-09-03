/**
 * Quita VALOR RECLAMADO = cédula en filas Excel duplicadas que el outbound
 * no tocó (se escribió solo la primera fila).
 * node scripts/repairAlfaExcelDuplicateCedulaW.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { pareceIdentificacionComoMontoAlfa } from '../utils/alfaExcelNormalize.js';
import { getAlfaExcelDefaultNumFmt } from '../utils/alfaExcelCellFormat.js';
import { ALFA_EXCEL_SHEET_NAME } from '../config/alfaExcelOwnershipMap.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import {
  downloadDriveItemBuffer,
  getItemMetadata,
  resolveDriveContext,
  createWorkbookSession,
  closeWorkbookSession,
  readWorkbookRange,
  updateWorkbookRange,
} from '../services/microsoftGraphService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

await mongoose.connect(process.env.MONGO_URI);

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
if (!src?.itemId || isAlfaExcelFinalProtectedName(src.fileName)) {
  console.error('ABORT', src?.fileName);
  await mongoose.disconnect();
  process.exit(1);
}

const casos = await SegurosAlfaCaso.find({})
  .select('consecutivo identificacion valorReclamado')
  .lean();
const byId = new Map();
for (const c of casos) {
  const id = String(c.identificacion || '').replace(/\D/g, '');
  if (!id) continue;
  if (!byId.has(id)) byId.set(id, []);
  byId.get(id).push(c);
}

const ctx = await resolveDriveContext();
const driveId = src.driveId || ctx.driveId;
const dl = await downloadDriveItemBuffer({ driveId, itemId: src.itemId });
const parsed = parseAlfaExcelBuffer(dl.buffer);
const sheetName = parsed.sheetName || ALFA_EXCEL_SHEET_NAME;

const targets = [];
for (const row of parsed.rows) {
  const id = String(row.payload?.identificacion || '').replace(/\D/g, '');
  if (!id) continue;
  const matches = byId.get(id) || [];
  if (!matches.length) continue;
  const rec = row.payload?.valorReclamado;
  const mongoNull = matches.every(
    (c) => c.valorReclamado == null || c.valorReclamado === '' || Number(c.valorReclamado) === 0
  );
  const fake = matches.some((c) => pareceIdentificacionComoMontoAlfa(rec, c.identificacion));
  if (!mongoNull || !fake) continue;
  if (Number(rec) === 0) continue;
  targets.push({
    rowNumber: row.rowNumber,
    identificacion: id,
    asegurado: row.payload?.asegurado,
    valorReclamado: rec,
    consecutivos: matches.map((c) => c.consecutivo),
  });
}

console.log(JSON.stringify({ file: src.fileName, leftoverFakeW: targets }, null, 2));
if (!targets.length) {
  await mongoose.disconnect();
  process.exit(0);
}

const session = await createWorkbookSession({ driveId, itemId: src.itemId, persistChanges: true });
const sessionId = session?.id;
const fmt = getAlfaExcelDefaultNumFmt('valorReclamado');
const verified = [];
try {
  for (const t of targets) {
    const address = `W${t.rowNumber}`;
    await updateWorkbookRange({
      driveId,
      itemId: src.itemId,
      worksheetName: sheetName,
      address,
      values: [[0]],
      numberFormat: fmt ? [[fmt]] : undefined,
      sessionId,
    });
    const range = await readWorkbookRange({
      driveId,
      itemId: src.itemId,
      worksheetName: sheetName,
      address,
      sessionId,
    });
    verified.push({
      address,
      consecutivo: t.consecutivos[0],
      actualValue: range?.values?.[0]?.[0] ?? null,
      actualText: range?.text?.[0]?.[0] ?? null,
    });
  }
} finally {
  if (sessionId) {
    await closeWorkbookSession({ driveId, itemId: src.itemId, sessionId });
  }
}

const meta = await getItemMetadata(src.itemId);
console.log(JSON.stringify({ wrote: verified, eTag: meta.eTag }, null, 2));
await mongoose.disconnect();
