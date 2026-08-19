/**
 * Empuja a SharePoint liquidación/siniestro/caso/ajustador de ARNALD (TERREMOTO).
 * Destapa filas para que Excel Online no falle.
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

function ensureVisible(ws) {
  if (ws.state === 'hidden' || ws.state === 'veryHidden') ws.state = 'visible';
  for (let r = 1; r <= Math.max(ws.rowCount || 0, 1); r += 1) {
    const row = ws.getRow(r);
    row.hidden = false;
    if (row.height === 0) row.height = 15;
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

const cfg = getEquidadFdmExcelSharePointConfig();
const source = await EquidadFdmExcelSharePointSource.findOne({
  integrationKey: cfg.integrationKey,
});
if (!source?.itemId) {
  console.error('NO_ITEM');
  process.exit(1);
}

const { driveId } = await resolveDriveContext();
const drive = source.driveId || driveId;
const downloaded = await downloadDriveItemBuffer({ driveId: drive, itemId: source.itemId });
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(downloaded?.buffer || downloaded);
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
for (let c = 1; c <= Math.max(hr.cellCount || 0, 60); c += 1) {
  const h = normHeader(headerText(hr.getCell(c).value));
  if (!h) continue;
  if (h.includes('CEDULA') || h.includes('IDENTIFICACION')) colByField.cedula = c;
  for (const [field, aliases] of Object.entries(FIELD_HEADERS)) {
    if (colByField[field] != null) continue;
    if (field === 'siniestro' || field === 'ajustador') {
      if (h === (field === 'siniestro' ? 'SINIESTRO' : 'AJUSTADOR')) colByField[field] = c;
      continue;
    }
    if (field === 'valorIndemnizado' && h.includes('AJUSTADOR')) continue;
    if (aliases.some((a) => h === normHeader(a))) colByField[field] = c;
  }
}
if (colByField.ajustador == null) {
  const ajCol = 41;
  ws.getRow(headerRow).getCell(ajCol).value = 'Ajustador';
  colByField.ajustador = ajCol;
}
console.log('cols', colByField);

const casos = await EquidadFdmCaso.find({
  $or: [
    { estado: /liquidado|girado|objetado/i },
    { siniestro: { $nin: [null, ''] } },
    { caso: { $nin: [null, ''] } },
    { ajustador: { $nin: [null, ''] } },
  ],
}).lean();

let written = 0;
let missing = 0;
for (const caso of casos) {
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
      field !== 'ajustador' &&
      String(value).trim() !== '' &&
      Number.isFinite(asNum) &&
      /^-?\d/.test(String(value).trim())
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
const outBuf = Buffer.from(await wb.xlsx.writeBuffer());
console.log(JSON.stringify({ written, missing, bytes: outBuf.length }, null, 2));

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
  console.log('UPLOAD_OK', source.eTag);
} catch (err) {
  console.error('UPLOAD_FAIL', err.code || '', err.message);
  process.exitCode = 1;
}

await mongoose.disconnect();
