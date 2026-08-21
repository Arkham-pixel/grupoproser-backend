/**
 * Quita del Excel BASE TERREMOTO las filas de personas Lorica
 * (no pertenecen a este evento). No toca YOJANIS/Lui/Herlin/Magnolia.
 *
 * Uso: node scripts/quitarLoricaDeExcelTerremoto.js [--apply]
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import EquidadFdmExcelSharePointSource from '../models/EquidadFdmExcelSharePointSource.js';
import { getEquidadFdmExcelSharePointConfig } from '../config/equidadFdmExcelSharePoint.js';
import {
  downloadDriveItemBuffer,
  replaceDriveItemContentBuffer,
  getItemMetadata,
} from '../services/microsoftGraphService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);
const apply = process.argv.includes('--apply');

function normHeader(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}
function headerCellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) {
      return value.richText.map((p) => p.text || '').join('');
    }
  }
  return String(value);
}
function cellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text).trim();
    if (value.result != null) return String(value.result).trim();
    if (Array.isArray(value.richText)) {
      return value.richText.map((p) => p.text || '').join('').trim();
    }
  }
  return String(value).trim();
}
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

// Personas Lorica en ARNALD (evento vacío / no terremoto, o municipio LORICA)
const loricaCasos = await EquidadFdmCaso.find({
  $or: [
    { municipio: /lorica/i },
    {
      $and: [
        { $or: [{ evento: null }, { evento: '' }] },
        { municipio: /lorica/i },
      ],
    },
  ],
})
  .select('cedula nombre municipio evento')
  .lean();

const cedulasLorica = new Set(
  loricaCasos.map((c) => soloDigitos(c.cedula)).filter((c) => c && c.length >= 5)
);

const cfg = getEquidadFdmExcelSharePointConfig();
const source = await EquidadFdmExcelSharePointSource.findOne({
  integrationKey: cfg.integrationKey,
}).lean();
const dl = await downloadDriveItemBuffer({
  driveId: source.driveId,
  itemId: source.itemId,
});
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(dl.buffer || dl);
const ws = wb.worksheets[0];

const col = {};
ws.getRow(1).eachCell({ includeEmpty: false }, (cell, c) => {
  const h = normHeader(headerCellText(cell.value));
  if (h === 'CEDULA') col.cedula = c;
  if (h === 'NOMBRE') col.nombre = c;
  if (h === 'MUNICIPIO' || h === 'CIUDAD' || h === 'CIUDAD MUNICIPIO') {
    col.municipio = c;
  }
});

const aEliminar = [];
for (let r = 2; r <= ws.rowCount; r += 1) {
  const row = ws.getRow(r);
  const nombre = cellText(row.getCell(col.nombre).value);
  const cedRaw = cellText(row.getCell(col.cedula).value);
  if (!nombre && !cedRaw) continue;
  const ced = soloDigitos(cedRaw);
  const mun = cellText(row.getCell(col.municipio).value).toUpperCase();
  const esLorica =
    (ced && cedulasLorica.has(ced)) || mun === 'LORICA' || mun.includes('LORICA');
  if (esLorica) {
    aEliminar.push({ row: r, nombre, cedula: cedRaw, municipio: mun || null });
  }
}

console.log(
  JSON.stringify(
    {
      dryRun: !apply,
      cedulasLoricaEnArnald: cedulasLorica.size,
      filasAEliminarDelExcelTerremoto: aEliminar.length,
      muestra: aEliminar.slice(0, 10),
    },
    null,
    2
  )
);

if (apply && aEliminar.length) {
  // Borrar de abajo hacia arriba para no desplazar índices
  for (const item of [...aEliminar].sort((a, b) => b.row - a.row)) {
    ws.spliceRows(item.row, 1);
  }
  const outBuf = Buffer.from(await wb.xlsx.writeBuffer());
  const meta = await getItemMetadata(source.itemId);
  await replaceDriveItemContentBuffer({
    driveId: source.driveId,
    itemId: source.itemId,
    buffer: outBuf,
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ifMatch: meta.eTag || source.eTag,
  });
  console.log('Eliminadas del Excel terremoto:', aEliminar.length);
}

await mongoose.disconnect();
