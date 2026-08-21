/**
 * Rellena CIUDAD/MUNICIPIO (y DEPARTAMENTO) en el Excel SharePoint
 * desde ARNALD — un solo upload.
 *
 * Uso: node scripts/pushFdmMunicipiosToExcel.js [--apply]
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
import { normalizarMunicipioFdm } from '../utils/fdmExcelParse.js';

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

function soloDigitos(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function normNombre(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const cfg = getEquidadFdmExcelSharePointConfig();
const source = await EquidadFdmExcelSharePointSource.findOne({
  integrationKey: cfg.integrationKey,
}).lean();
if (!source?.itemId) {
  console.error('Excel SharePoint no localizado');
  process.exit(1);
}

const casos = await EquidadFdmCaso.find({ evento: /terremoto/i })
  .select('nombre cedula municipio departamento oficinaRadicadora')
  .lean();

const byCedula = new Map();
const byNombre = new Map();
for (const c of casos) {
  const mun = normalizarMunicipioFdm(c.municipio);
  if (!mun) continue;
  const ced = soloDigitos(c.cedula);
  if (ced && ced !== '0') {
    if (!byCedula.has(ced)) byCedula.set(ced, c);
  }
  const nom = normNombre(c.nombre);
  if (nom && nom !== 'YOJANIS') {
    if (!byNombre.has(nom)) byNombre.set(nom, c);
  }
}

const dl = await downloadDriveItemBuffer({
  driveId: source.driveId,
  itemId: source.itemId,
});
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(dl.buffer || dl);
const ws = wb.worksheets[0];
if (!ws) {
  console.error('Sin hojas');
  process.exit(1);
}

let headerRow = 1;
const colByField = {};
for (let r = 1; r <= Math.min(10, ws.rowCount); r += 1) {
  const row = ws.getRow(r);
  let hit = false;
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = normHeader(headerCellText(cell.value));
    if (!h) return;
    if (h.includes('CEDULA') || h === 'NOMBRE') hit = true;
    if (h === 'CEDULA' || h === 'IDENTIFICACION') colByField.cedula = col;
    if (h === 'NOMBRE' || h.startsWith('NOMBRE ')) colByField.nombre = col;
    if (
      h === 'MUNICIPIO' ||
      h === 'CIUDAD' ||
      h === 'CIUDAD MUNICIPIO'
    ) {
      colByField.municipio = col;
    }
    if (h === 'DEPARTAMENTO') colByField.departamento = col;
    if (h === 'OFICINA RADICADORA' || h === 'OFICINA') {
      colByField.oficinaRadicadora = col;
    }
  });
  if (hit && colByField.municipio) {
    headerRow = r;
    break;
  }
}

if (!colByField.municipio) {
  console.error('No se encontró columna CIUDAD/MUNICIPIO', colByField);
  process.exit(1);
}

let dataRows = 0;
let sinCiudadAntes = 0;
let rellenados = 0;
let sinMatch = 0;
let yaOk = 0;
const sinMatchSample = [];

for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
  const row = ws.getRow(r);
  const nombre = colByField.nombre
    ? cellText(row.getCell(colByField.nombre).value)
    : '';
  const cedulaRaw = colByField.cedula
    ? cellText(row.getCell(colByField.cedula).value)
    : '';
  if (!nombre && !cedulaRaw) continue;
  dataRows += 1;

  const munExcel = cellText(row.getCell(colByField.municipio).value);
  const munExcelNorm = normalizarMunicipioFdm(munExcel === '0' ? '' : munExcel);
  if (munExcelNorm) {
    yaOk += 1;
    continue;
  }
  sinCiudadAntes += 1;

  const ced = soloDigitos(cedulaRaw);
  let caso = ced && ced !== '0' ? byCedula.get(ced) : null;
  if (!caso) caso = byNombre.get(normNombre(nombre)) || null;
  const munArnald = caso ? normalizarMunicipioFdm(caso.municipio) : '';
  if (!munArnald) {
    sinMatch += 1;
    if (sinMatchSample.length < 8) {
      sinMatchSample.push({ row: r, nombre, cedula: cedulaRaw });
    }
    continue;
  }

  rellenados += 1;
  if (apply) {
    row.getCell(colByField.municipio).value = munArnald;
    if (colByField.departamento && caso.departamento) {
      const depExcel = cellText(row.getCell(colByField.departamento).value);
      if (!depExcel || depExcel === '0') {
        row.getCell(colByField.departamento).value = caso.departamento;
      }
    }
  }
}

console.log(
  JSON.stringify(
    {
      dryRun: !apply,
      sheet: ws.name,
      headerRow,
      colMunicipio: colByField.municipio,
      dataRows,
      sinCiudadAntes,
      yaOk,
      rellenadosDesdeArnald: rellenados,
      quedanSinCiudad: sinMatch,
      sinMatchSample,
    },
    null,
    2
  )
);

if (apply && rellenados > 0) {
  // Asegurar filas visibles
  for (let r = 1; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    if (row.hidden) row.hidden = false;
  }
  const outBuf = Buffer.from(await wb.xlsx.writeBuffer());
  const metaBefore = await getItemMetadata(source.itemId);
  await replaceDriveItemContentBuffer({
    driveId: source.driveId,
    itemId: source.itemId,
    buffer: outBuf,
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ifMatch: metaBefore.eTag || source.eTag,
  });
  console.log('Excel SharePoint actualizado OK');
}

await mongoose.disconnect();
