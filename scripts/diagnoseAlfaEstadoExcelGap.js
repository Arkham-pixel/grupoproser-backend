import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  resetMicrosoftGraphClient,
  getAccessToken,
  downloadDriveItemBuffer,
  getItemMetadata,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';
import { selectAlfaExcelFromSharePointFolder } from '../services/alfaExcelSharePointImportService.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import { normalizeIdentification } from '../utils/alfaExcelNormalize.js';
import * as XLSX from 'xlsx';

await mongoose.connect(process.env.MONGO_URI);
const by = await SegurosAlfaCaso.aggregate([
  { $group: { _id: '$estado', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);
console.log('ARNALD estados', JSON.stringify(by));

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
const estadoIdx = header.findIndex((h) => /estado/i.test(h) && !/pago|primas/i.test(h));
console.log('estadoCol', estadoIdx, header[estadoIdx]);

let emptyEstado = 0;
const emptyRows = [];
for (let i = 1; i < rows.length; i++) {
  const id = rows[i][1];
  const estado = String(rows[i][estadoIdx] ?? '').trim();
  if (!String(id || '').trim()) continue;
  if (!estado) {
    emptyEstado += 1;
    emptyRows.push({
      excelRow: i + 1,
      id: String(id),
      asegurado: rows[i][2],
      poliza: rows[i][4],
    });
  }
}
console.log('excelEmptyEstado', emptyEstado);
console.log(JSON.stringify(emptyRows.slice(0, 20), null, 2));

// match to ARNALD
const casos = await SegurosAlfaCaso.find({})
  .select('consecutivo identificacion numeroPoliza estado')
  .lean();
const byId = new Map();
for (const c of casos) {
  const id = normalizeIdentification(c.identificacion);
  if (!id) continue;
  if (!byId.has(id)) byId.set(id, []);
  byId.get(id).push(c);
}
for (const er of emptyRows) {
  const id = normalizeIdentification(er.id);
  const hits = byId.get(id) || [];
  console.log(
    'EMPTY',
    er.excelRow,
    er.asegurado,
    'ARNALD',
    hits.map((h) => `${h.consecutivo}:${h.estado}`).join(' | ') || '(sin caso)'
  );
}
await mongoose.disconnect();
