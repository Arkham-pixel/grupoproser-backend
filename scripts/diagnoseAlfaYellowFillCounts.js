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

const filledEstado = [];
const filledFecha = [];
for (let i = 1; i < rows.length; i++) {
  const est = String(rows[i][estadoIdx] ?? '').trim();
  const fec = String(rows[i][fechaIdx] ?? '').trim();
  if (est) filledEstado.push({ row: i + 1, id: rows[i][1], aseg: rows[i][2], est, fec });
  if (fec) filledFecha.push({ row: i + 1, id: rows[i][1], aseg: rows[i][2], est, fec });
}
console.log('excelConEstado', filledEstado.length);
filledEstado.forEach((r) => console.log(JSON.stringify(r)));
console.log('excelConFechaInspeccion', filledFecha.length);

const arnaldFecha = await SegurosAlfaCaso.find({
  fechaInspeccion: { $ne: null, $exists: true },
})
  .select('consecutivo identificacion estado fechaInspeccion')
  .lean();
console.log('ARNALD con fechaInspeccion', arnaldFecha.length);

const excelFechaIds = new Set(
  filledFecha.map((r) => normalizeIdentification(r.id)).filter(Boolean)
);
const missingFecha = [];
for (const c of arnaldFecha) {
  const id = normalizeIdentification(c.identificacion);
  // any excel row with this id having fecha?
  let ok = false;
  for (const r of filledFecha) {
    if (normalizeIdentification(r.id) === id) {
      ok = true;
      break;
    }
  }
  if (!ok) missingFecha.push(c);
}
console.log('faltanFechaEnExcel', missingFecha.length);
missingFecha.forEach((c) =>
  console.log(
    c.consecutivo,
    c.identificacion,
    c.estado,
    c.fechaInspeccion
  )
);

const arnaldEstadoAdv = await SegurosAlfaCaso.find({
  estado: { $nin: [null, '', 'PENDIENTE'] },
})
  .select('consecutivo identificacion estado')
  .lean();
console.log('ARNALD estado!=PENDIENTE', arnaldEstadoAdv.length);
for (const c of arnaldEstadoAdv) {
  const id = normalizeIdentification(c.identificacion);
  const hits = filledEstado.filter((r) => normalizeIdentification(r.id) === id);
  if (!hits.length) {
    console.log('SIN_ESTADO_EXCEL', c.consecutivo, id, c.estado);
  }
}
await mongoose.disconnect();
