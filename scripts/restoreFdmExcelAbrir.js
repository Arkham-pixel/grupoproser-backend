/**
 * Restaura BASE TERREMOTO desde copia local buena + datos ARNALD, sube a SharePoint
 * y deja copia local abrible.
 */
import '../config/loadEnv.js';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import EquidadFdmExcelSharePointSource from '../models/EquidadFdmExcelSharePointSource.js';
import { getEquidadFdmExcelSharePointConfig } from '../config/equidadFdmExcelSharePoint.js';
import {
  replaceDriveItemContentBuffer,
  getItemMetadata,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const BASE_LOCAL = path.resolve('C:/Users/GP-TI/Downloads/BASE TERREMOTO 10 DE AGOSTO.xlsx');
const OUT_LOCAL = path.resolve('C:/Users/GP-TI/Downloads/BASE_TERREMOTO_REPARADO_ABRIR.xlsx');

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

function headerText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
  }
  return String(value);
}

function ensureVisible(ws) {
  if (ws.state === 'hidden' || ws.state === 'veryHidden') ws.state = 'visible';
  const maxRow = Math.max(ws.rowCount || 0, 1);
  for (let r = 1; r <= maxRow; r += 1) {
    const row = ws.getRow(r);
    row.hidden = false;
    if (row.height === 0) row.height = 15;
  }
  const maxCol = Math.max(ws.columnCount || 0, 45);
  for (let c = 1; c <= maxCol; c += 1) {
    const col = ws.getColumn(c);
    if (col.hidden) col.hidden = false;
  }
  ws.autoFilter = undefined;
}

const FIELD_HEADERS = {
  estado: ['ESTADO'],
  siniestro: ['SINIESTRO'],
  caso: ['CASO'],
  ajustador: ['AJUSTADOR'],
  totalLiquidado: ['TOTAL LIQUIDADO'],
  deducible: ['DEDUCIBLE'],
  totalPerdida: ['TOTAL PERDIDA'],
  perdidaContenidos: ['PERDIDA POR CONTENIDOS'],
  perdidaEdificio: ['PERDIDA POR EDIFICIO'],
  subsidio: ['SUBSIDIO'],
  valorIndemnizadoAjustador: ['VALOR INDEMNIZADO AJUSTADOR'],
  valorIndemnizado: ['VALOR INDEMNIZADO'],
  fechaLiquidacion: ['FECHA DE LIQUIDACION', 'FECHA LIQUIDACION'],
  fechaGiro: ['FECHA DE GIRO', 'FECHA GIRO'],
};

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

if (!fs.existsSync(BASE_LOCAL)) {
  console.error('NO_BASE_LOCAL', BASE_LOCAL);
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(BASE_LOCAL);
const ws = wb.worksheets[0];

let headerRow = 1;
for (let r = 1; r <= 10; r += 1) {
  let hit = false;
  ws.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
    if (normHeader(headerText(cell.value)).includes('CEDULA')) hit = true;
  });
  if (hit) {
    headerRow = r;
    break;
  }
}

const colByField = {};
const hr = ws.getRow(headerRow);
const maxCol = Math.max(hr.cellCount || 0, 60);
for (let c = 1; c <= maxCol; c += 1) {
  const h = normHeader(headerText(hr.getCell(c).value));
  if (!h) continue;
  if (h.includes('CEDULA') || h.includes('IDENTIFICACION')) colByField.cedula = c;
  for (const [field, aliases] of Object.entries(FIELD_HEADERS)) {
    if (colByField[field] != null) continue;
    if (field === 'siniestro') {
      if (h === 'SINIESTRO') colByField.siniestro = c;
      continue;
    }
    if (field === 'ajustador') {
      if (h === 'AJUSTADOR') colByField.ajustador = c;
      continue;
    }
    if (field === 'valorIndemnizado' && h.includes('AJUSTADOR')) continue;
    if (aliases.some((a) => h === normHeader(a))) colByField[field] = c;
  }
}
console.log('cols', colByField);

const liquidados = await EquidadFdmCaso.find({
  $or: [
    { estado: /liquidado|girado|objetado/i },
    { siniestro: { $nin: [null, ''] } },
    { ajustador: { $nin: [null, ''] } },
  ],
}).lean();

let written = 0;
let missing = 0;
for (const caso of liquidados) {
  const target = String(caso.cedula || '').replace(/\D/g, '');
  if (!target || !colByField.cedula) {
    missing += 1;
    continue;
  }
  let rowNum = -1;
  for (let r = headerRow + 1; r <= (ws.rowCount || 0); r += 1) {
    const dig = String(headerText(ws.getRow(r).getCell(colByField.cedula).value) || '').replace(
      /\D/g,
      ''
    );
    if (dig && dig === target) {
      rowNum = r;
      break;
    }
  }
  if (rowNum < 0) {
    missing += 1;
    continue;
  }
  const row = ws.getRow(rowNum);
  const put = (field, value) => {
    const col = colByField[field];
    if (col == null || value == null || value === '') return;
    // No escribir direcciones en ajustador
    if (
      field === 'ajustador' &&
      (/sistema\s*osiris/i.test(String(value)) ||
        /^(CLL|CRA|CALLE|CARRERA|MANZANA|SUBA)/i.test(String(value).trim()))
    ) {
      return;
    }
    const cell = row.getCell(col);
    if (value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))) {
      const d = value instanceof Date ? value : new Date(value);
      if (!Number.isNaN(d.getTime())) {
        cell.value = d;
        cell.numFmt = 'dd/mm/yyyy';
        return;
      }
    }
    if (typeof value === 'number') {
      cell.value = value;
      return;
    }
    const asNum = Number(String(value).replace(/[^\d.-]/g, ''));
    if (
      String(value).trim() !== '' &&
      Number.isFinite(asNum) &&
      /^-?\d/.test(String(value).trim()) &&
      field !== 'ajustador'
    ) {
      cell.value = asNum;
    } else {
      cell.value = String(value);
    }
  };
  put('estado', caso.estado);
  put('siniestro', caso.siniestro);
  put('caso', caso.caso);
  put('ajustador', caso.ajustador);
  put('totalLiquidado', caso.totalLiquidado);
  put('deducible', caso.deducible);
  put('totalPerdida', caso.totalPerdida);
  put('perdidaContenidos', caso.perdidaContenidos);
  put('perdidaEdificio', caso.perdidaEdificio);
  put('subsidio', caso.subsidio);
  put('valorIndemnizadoAjustador', caso.valorIndemnizadoAjustador);
  put('valorIndemnizado', caso.valorIndemnizado);
  put('fechaLiquidacion', caso.fechaLiquidacion);
  put('fechaGiro', caso.fechaGiro);
  row.hidden = false;
  row.commit();
  written += 1;
}

ensureVisible(ws);
await wb.xlsx.writeFile(OUT_LOCAL);
const outBuf = fs.readFileSync(OUT_LOCAL);
console.log(JSON.stringify({ written, missing, outLocal: OUT_LOCAL, bytes: outBuf.length }, null, 2));

const cfg = getEquidadFdmExcelSharePointConfig();
const source = await EquidadFdmExcelSharePointSource.findOne({
  integrationKey: cfg.integrationKey,
});
if (!source?.itemId) {
  console.error('NO_SP_ITEM');
  process.exit(1);
}

try {
  const { driveId } = await resolveDriveContext();
  const meta = await getItemMetadata(source.itemId);
  const uploaded = await replaceDriveItemContentBuffer({
    driveId: source.driveId || driveId,
    itemId: source.itemId,
    buffer: outBuf,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ifMatch: meta.eTag,
  });
  source.eTag = uploaded?.eTag || meta.eTag;
  source.lastArnaldWrittenEtag = source.eTag;
  source.lastSyncAt = new Date();
  await source.save();
  console.log('UPLOAD_OK', source.eTag);
} catch (err) {
  console.error('UPLOAD_FAIL', err.code || '', err.message);
  console.log('Abre la copia local:', OUT_LOCAL);
  process.exitCode = 1;
}

await mongoose.disconnect();
