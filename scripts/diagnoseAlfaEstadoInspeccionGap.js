import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import {
  resetMicrosoftGraphClient,
  getAccessToken,
  downloadDriveItemBuffer,
  getItemMetadata,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';
import { selectAlfaExcelFromSharePointFolder } from '../services/alfaExcelSharePointImportService.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import { normalizeIdentification } from '../utils/alfaExcelNormalize.js';
import * as XLSX from 'xlsx';

await mongoose.connect(process.env.MONGO_URI);

const inspeccion = await SegurosAlfaCaso.find({
  estado: { $regex: /inspecci[oó]n/i },
})
  .select('consecutivo identificacion numeroPoliza estado fechaInspeccion controlSeguimientoExcel')
  .lean();

console.log('ARNALD EN INSPECCION', inspeccion.length);

resetMicrosoftGraphClient();
await getAccessToken();
const cfg = getAlfaExcelSharePointImportConfig();
const { driveId } = await resolveDriveContext();
const sel = await selectAlfaExcelFromSharePointFolder(cfg.rootPath, cfg.fileName);
const meta = await getItemMetadata(sel.selected.itemId);
const { buffer } = await downloadDriveItemBuffer({ driveId, itemId: meta.id });
const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
const sheet = wb.Sheets['BD'] || wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
const header = rows[0].map(String);
const estadoIdx = header.findIndex((h) => /^estado$/i.test(String(h).trim()) || ( /estado/i.test(h) && !/pago|primas/i.test(h)));
const fechaInsIdx = header.findIndex((h) => /fecha\s*inspecci/i.test(h));

const excelById = new Map();
for (let i = 1; i < rows.length; i++) {
  const id = normalizeIdentification(rows[i][1]);
  if (!id) continue;
  if (!excelById.has(id)) excelById.set(id, []);
  excelById.get(id).push({
    excelRow: i + 1,
    estado: String(rows[i][estadoIdx] ?? '').trim(),
    fechaInspeccion: String(rows[i][fechaInsIdx] ?? '').trim(),
    poliza: rows[i][4],
  });
}

let filled = 0;
let missing = 0;
for (const c of inspeccion) {
  const id = normalizeIdentification(c.identificacion);
  const hits = excelById.get(id) || [];
  const withEstado = hits.filter((h) => h.estado);
  const ok = withEstado.some((h) => /inspecci/i.test(h.estado));
  if (ok) filled += 1;
  else {
    missing += 1;
    console.log(
      JSON.stringify({
        consecutivo: c.consecutivo,
        id,
        estadoArnald: c.estado,
        fechaInspeccion: c.fechaInspeccion,
        excelHits: hits,
        sync: c.controlSeguimientoExcel || null,
      })
    );
  }
}
console.log(JSON.stringify({ filled, missing, total: inspeccion.length }));

const pending = await AlfaExcelOutboundUpdate.countDocuments({ status: 'pending' });
const failed = await AlfaExcelOutboundUpdate.find({ status: 'failed' })
  .sort({ updatedAt: -1 })
  .limit(10)
  .lean();
const recentEstado = await AlfaExcelOutboundUpdate.find({ 'changes.estado': { $exists: true } })
  .sort({ updatedAt: -1 })
  .limit(10)
  .select('consecutivo status changes.estado lastError updatedAt')
  .lean();
console.log('outbox pending', pending);
console.log('recent estado outbounds', JSON.stringify(recentEstado, null, 2));
console.log(
  'failed sample',
  JSON.stringify(
    failed.map((f) => ({
      consecutivo: f.consecutivo,
      err: f.lastError,
      changes: Object.keys(f.changes || {}),
    })),
    null,
    2
  )
);

await mongoose.disconnect();
