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
import { normalizeIdentification } from '../utils/alfaExcelNormalize.js';
import * as XLSX from 'xlsx';

await mongoose.connect(process.env.MONGO_URI);
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
const estadoIdx = 27;
const fechaIdx = header.findIndex((h) => /fecha\s*inspecci/i.test(h));

const gap = [];
for (let i = 1; i < rows.length; i++) {
  const fec = String(rows[i][fechaIdx] ?? '').trim();
  const est = String(rows[i][estadoIdx] ?? '').trim();
  if (fec && !est) {
    gap.push({
      excelRow: i + 1,
      id: String(rows[i][1]),
      asegurado: rows[i][2],
      poliza: rows[i][4],
      fechaExcel: fec,
    });
  }
}
console.log('fechaSinEstado', gap.length);

for (const g of gap) {
  const id = normalizeIdentification(g.id);
  const caso = await SegurosAlfaCaso.findOne({
    identificacion: new RegExp(id?.slice(-8) || 'NOPE'),
  })
    .select('consecutivo identificacion estado fechaInspeccion')
    .lean();
  // better match
  const all = await SegurosAlfaCaso.find({})
    .select('consecutivo identificacion estado fechaInspeccion')
    .lean();
  const hits = all.filter((c) => normalizeIdentification(c.identificacion) === id);
  console.log(
    JSON.stringify({
      ...g,
      arnald: hits.map((h) => ({
        consecutivo: h.consecutivo,
        estado: h.estado,
        fechaInspeccion: h.fechaInspeccion,
      })),
    })
  );
}
await mongoose.disconnect();
