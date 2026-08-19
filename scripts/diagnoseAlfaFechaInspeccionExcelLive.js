/**
 * Lee FECHA INSPECCIÓN del Excel SharePoint y cruza con ARNALD.
 * node scripts/diagnoseAlfaFechaInspeccionExcelLive.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  listFolder,
  downloadDriveItemBuffer,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';
import { resetMicrosoftGraphClient } from '../services/microsoftGraphService.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';

resetMicrosoftGraphClient();
await mongoose.connect(process.env.MONGO_URI);

const cfg = getAlfaExcelSharePointImportConfig();
const listed = await listFolder(cfg.rootPath, { top: 50 });
const file = (listed.children || []).find((c) => c.name === cfg.fileName && !c.folder);
if (!file) throw new Error(`Excel no encontrado: ${cfg.fileName}`);

const { driveId } = await resolveDriveContext();
const { buffer } = await downloadDriveItemBuffer({ driveId, itemId: file.id });

const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
const sheet = wb.Sheets[wb.SheetNames[0]];
const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
const header = (aoa[0] || []).map((h) => String(h || '').toUpperCase().trim());
const colFecha = header.findIndex((h) => h.includes('FECHA INSPECC'));
const colId = header.findIndex((h) => h.includes('IDENTIFIC'));
const colAseg = header.findIndex((h) => h.includes('ASEGURADO'));
const colPol = header.findIndex((h) => h.includes('PÓLIZA') || h.includes('POLIZA'));

const excelConFecha = [];
for (let i = 1; i < aoa.length; i += 1) {
  const row = aoa[i] || [];
  const fecha = row[colFecha];
  if (fecha == null || String(fecha).trim() === '') continue;
  excelConFecha.push({
    excelRow: i + 1,
    fecha: String(fecha),
    id: String(row[colId] || ''),
    asegurado: String(row[colAseg] || '').slice(0, 40),
    poliza: String(row[colPol] || ''),
  });
}

const arnald = await SegurosAlfaCaso.find({
  fechaInspeccion: { $exists: true, $nin: [null, ''] },
})
  .select('consecutivo identificacion asegurado fechaInspeccion numeroPoliza')
  .lean();

const normId = (v) => String(v || '').replace(/\D/g, '');
const excelIds = new Set(excelConFecha.map((r) => normId(r.id)).filter(Boolean));

const enArnaldNoExcel = arnald.filter((c) => !excelIds.has(normId(c.identificacion)));
const excelIdsOnly = [...excelIds].filter(
  (id) => !arnald.some((c) => normId(c.identificacion) === id)
);

console.log(
  JSON.stringify(
    {
      excelFile: file.name,
      colFechaInspeccion: colFecha,
      excelConFechaCount: excelConFecha.length,
      arnaldConFechaCount: arnald.length,
      enArnaldNoEnExcel: enArnaldNoExcel.map((c) => ({
        consecutivo: c.consecutivo,
        id: c.identificacion,
        asegurado: String(c.asegurado || '').slice(0, 40),
        fechaInspeccion: c.fechaInspeccion,
        poliza: c.numeroPoliza,
      })),
      excelSinMatchArnaldFecha: excelConFecha
        .filter((r) => excelIdsOnly.includes(normId(r.id)))
        .slice(0, 20),
      excelFechas: excelConFecha,
    },
    null,
    2
  )
);

await mongoose.disconnect();
