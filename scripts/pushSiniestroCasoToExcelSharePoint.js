/**
 * Descarga BASE TERREMOTO de SharePoint, escribe siniestro/caso (y liquidación) desde ARNALD, sube de nuevo.
 * No borra filas ni otros datos del Excel.
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
  resolveDriveContext,
} from '../services/microsoftGraphService.js';
import { runEquidadFdmExcelSharePointDetectCycle } from '../services/equidadFdmExcelSharePointService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

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

const FIELD_HEADERS = {
  estado: ['ESTADO'],
  siniestro: ['SINIESTRO'],
  caso: ['CASO'],
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

const cfg = getEquidadFdmExcelSharePointConfig();
let source = await EquidadFdmExcelSharePointSource.findOne({ integrationKey: cfg.integrationKey });
if (!source?.itemId) {
  await runEquidadFdmExcelSharePointDetectCycle({ force: true });
  source = await EquidadFdmExcelSharePointSource.findOne({ integrationKey: cfg.integrationKey });
}
if (!source?.itemId) {
  console.error('NO_SHAREPOINT_ITEM');
  process.exit(1);
}

const { driveId } = await resolveDriveContext();
const drive = source.driveId || driveId;
const downloaded = await downloadDriveItemBuffer({ driveId: drive, itemId: source.itemId });
const buffer = downloaded?.buffer || downloaded;

const liquidados = await EquidadFdmCaso.find({
  estado: /liquidado|girado|objetado/i,
  $or: [{ siniestro: { $nin: [null, ''] } }, { caso: { $nin: [null, ''] } }],
}).lean();
console.log('casosConSiniestroOCaso', liquidados.length);

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);
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
    if (field === 'valorIndemnizado' && h.includes('AJUSTADOR')) continue;
    if (aliases.some((a) => h === normHeader(a))) colByField[field] = c;
  }
}
console.log('cols', colByField);
if (colByField.siniestro == null) {
  console.error('COLUMNA_SINIESTRO_NO_ENCONTRADA');
  process.exit(1);
}

let written = 0;
let missing = 0;
let filledSiniestro = 0;
const samples = [];

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
    if (col == null || value == null || value === '') return false;
    const cell = row.getCell(col);
    if (value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))) {
      const d = value instanceof Date ? value : new Date(value);
      if (!Number.isNaN(d.getTime())) {
        cell.value = d;
        cell.numFmt = 'dd/mm/yyyy';
        return true;
      }
    }
    const asNum = Number(String(value).replace(/[^\d.-]/g, ''));
    cell.value =
      String(value).trim() !== '' && Number.isFinite(asNum) && /^-?\d/.test(String(value).trim())
        ? asNum
        : value;
    return true;
  };
  if (put('siniestro', caso.siniestro)) {
    filledSiniestro += 1;
    if (samples.length < 10) {
      samples.push({
        cedula: caso.cedula,
        caso: caso.caso,
        siniestro: caso.siniestro,
        row: rowNum,
      });
    }
  }
  put('caso', caso.caso);
  put('estado', caso.estado);
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
  row.commit();
  written += 1;
}

console.log(JSON.stringify({ written, missing, filledSiniestro, samples }, null, 2));

const outBuf = Buffer.from(await wb.xlsx.writeBuffer());
try {
  const meta = await getItemMetadata(source.itemId);
  const uploaded = await replaceDriveItemContentBuffer({
    driveId: drive,
    itemId: source.itemId,
    buffer: outBuf,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ifMatch: meta.eTag,
  });
  source.eTag = uploaded?.eTag || meta.eTag;
  source.lastArnaldWrittenEtag = source.eTag;
  source.lastSyncAt = new Date();
  await source.save();
  console.log('UPLOAD_OK', { eTag: source.eTag, bytes: outBuf.length });
} catch (err) {
  console.error('UPLOAD_FAIL', err.code || '', err.message);
  process.exitCode = 1;
}

await mongoose.disconnect();
