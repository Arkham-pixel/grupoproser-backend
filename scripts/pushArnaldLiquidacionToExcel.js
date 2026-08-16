/**
 * 1) Escribe en el Excel local los LIQUIDADO de ARNALD (sin tocar el resto).
 * 2) Intenta subir ese Excel a SharePoint.
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import dns from 'dns';
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
import { runEquidadFdmExcelSharePointDetectCycle } from '../services/equidadFdmExcelSharePointService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const EXCEL_PATH = path.resolve('C:/Users/GP-TI/Downloads/BASE TERREMOTO 10 DE AGOSTO.xlsx');
const OUT_PATH = path.resolve(
  'C:/Users/GP-TI/Downloads/BASE_TERREMOTO_10_AGOSTO_SYNC_ARNALD.xlsx'
);

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
  celular: ['CELULAR', 'TELEFONO'],
  siniestro: ['SINIESTRO'],
  caso: ['CASO'],
  totalLiquidado: ['TOTAL LIQUIDADO'],
  deducible: ['DEDUCIBLE'],
  totalPerdida: ['TOTAL PERDIDA'],
  perdidaContenidos: ['PERDIDA POR CONTENIDOS'],
  perdidaEdificio: ['PERDIDA POR EDIFICIO'],
  subsidio: ['SUBSIDIO'],
  valorIndemnizadoAjustador: ['VALOR INDEMNIZADO AJUSTADOR', 'VALOR INDEMNIZADO(AJUSTADOR)'],
  valorIndemnizado: ['VALOR INDEMNIZADO'],
  fechaLiquidacion: ['FECHA DE LIQUIDACION', 'FECHA LIQUIDACION'],
  fechaGiro: ['FECHA DE GIRO', 'FECHA GIRO'],
  observaciones: ['OBSERVACIONES', 'OBSERVACION'],
};

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const allLiq = await EquidadFdmCaso.countDocuments({ estado: /liquidado/i });
const allPend = await EquidadFdmCaso.countDocuments({ estado: /pendiente/i });
const allObj = await EquidadFdmCaso.countDocuments({ estado: /objetado/i });
console.log(JSON.stringify({ allLiq, allPend, allObj }, null, 2));

const liquidados = await EquidadFdmCaso.find({ estado: /liquidado|girado|objetado/i }).lean();
console.log('casosAEscribirExcel', liquidados.length);

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(EXCEL_PATH);
const ws = wb.worksheets[0];

let headerRow = 1;
for (let r = 1; r <= 10; r += 1) {
  let hit = false;
  ws.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
    const h = normHeader(headerText(cell.value));
    if (h.includes('CEDULA')) hit = true;
  });
  if (hit) {
    headerRow = r;
    break;
  }
}

const colByField = {};
const hr = ws.getRow(headerRow);
const maxCol = Math.max(hr.cellCount || 0, 45);
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
    if (aliases.some((a) => h === normHeader(a))) {
      if (field === 'valorIndemnizado' && h.includes('AJUSTADOR')) continue;
      colByField[field] = c;
    }
  }
  if (h.startsWith('SINIESTRO ') && /(INDEMNIZ|AFECTAC)/.test(h) && colByField.siniestroIndemnizado == null) {
    colByField.siniestroIndemnizado = c;
  }
}
if (colByField.fechaLiquidacion == null && colByField.fechaGiro != null) {
  colByField.fechaLiquidacion = colByField.fechaGiro;
}

console.log('cols', colByField);

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
    const cell = row.getCell(col);
    if (value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))) {
      const d = value instanceof Date ? value : new Date(value);
      if (!Number.isNaN(d.getTime())) {
        cell.value = d;
        cell.numFmt = 'dd/mm/yyyy';
        return;
      }
    }
    cell.value = value;
  };
  put('estado', caso.estado);
  put('celular', caso.celular);
  put('siniestro', caso.siniestro);
  put('caso', caso.caso);
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
  put('observaciones', caso.observaciones);
  row.commit();
  written += 1;
}

await wb.xlsx.writeFile(OUT_PATH);
const outBuf = fs.readFileSync(OUT_PATH);
console.log(JSON.stringify({ written, missing, outPath: OUT_PATH, bytes: outBuf.length }, null, 2));

const cfg = getEquidadFdmExcelSharePointConfig();
let source = await EquidadFdmExcelSharePointSource.findOne({ integrationKey: cfg.integrationKey });
if (!source?.itemId) {
  try {
    await runEquidadFdmExcelSharePointDetectCycle({ force: true });
  } catch {
    /* ignore */
  }
  source = await EquidadFdmExcelSharePointSource.findOne({ integrationKey: cfg.integrationKey });
}

if (!source?.itemId) {
  console.log('UPLOAD_SKIPPED_NO_ITEM');
} else {
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
    console.log('UPLOAD_OK', { eTag: source.eTag });
    const detect = await runEquidadFdmExcelSharePointDetectCycle({ force: true });
    console.log('DETECT', {
      outcome: detect.outcome,
      status: detect.status,
      summary: detect.source?.summary,
    });
  } catch (err) {
    console.log('UPLOAD_FAIL', err.code || err.message);
    console.log('Deja el archivo cerrado en SharePoint y reintenta.');
  }
}

await mongoose.disconnect();
