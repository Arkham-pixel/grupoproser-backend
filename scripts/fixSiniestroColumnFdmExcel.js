/**
 * Mueve números de "SINIESTRO O INDEMNIZADO" → columna exacta "SINIESTRO"
 * y actualiza ARNALD.siniestro. No borra casos.
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
  downloadDriveItemBuffer,
  replaceDriveItemContentBuffer,
  getItemMetadata,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';
import { enqueueEquidadFdmExcelOutboundFromCaseUpdate } from '../services/equidadFdmExcelOutboundService.js';

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

function cellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
  }
  return String(value);
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const cfg = getEquidadFdmExcelSharePointConfig();
const source = await EquidadFdmExcelSharePointSource.findOne({
  integrationKey: cfg.integrationKey,
});
if (!source?.itemId) throw new Error('Sin item SharePoint');

const { driveId } = await resolveDriveContext();
const downloaded = await downloadDriveItemBuffer({
  driveId: source.driveId || driveId,
  itemId: source.itemId,
});
const buffer = downloaded?.buffer || downloaded;

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);
const ws = wb.worksheets[0];

let headerRow = 1;
for (let r = 1; r <= 10; r += 1) {
  let hit = false;
  ws.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
    if (normHeader(cellText(cell.value)).includes('CEDULA')) hit = true;
  });
  if (hit) {
    headerRow = r;
    break;
  }
}

let colCedula = null;
let colSiniestro = null;
let colSinIndem = null;
const hr = ws.getRow(headerRow);
const maxCol = Math.max(hr.cellCount || 0, 55);
for (let c = 1; c <= maxCol; c += 1) {
  const h = normHeader(cellText(hr.getCell(c).value));
  if (!h) continue;
  if ((h.includes('CEDULA') || h.includes('IDENTIFICACION')) && colCedula == null) colCedula = c;
  if (h === 'SINIESTRO') colSiniestro = c;
  if (h.startsWith('SINIESTRO ') && /(INDEMNIZ|AFECTAC)/.test(h) && colSinIndem == null) {
    colSinIndem = c;
  }
}

console.log({ headerRow, colCedula, colSiniestro, colSinIndem });
if (!colCedula || !colSiniestro || !colSinIndem) {
  throw new Error('No se localizaron columnas CEDULA / SINIESTRO / SINIESTRO O INDEMNIZADO');
}

let movedExcel = 0;
let updatedArnald = 0;
const samples = [];

const terrCasos = await EquidadFdmCaso.find({ evento: /TERREMOTO/i });
const byCed = new Map();
for (const doc of terrCasos) {
  const d = String(doc.cedula || '').replace(/\D/g, '');
  if (d) byCed.set(d, doc);
}

for (let r = headerRow + 1; r <= (ws.rowCount || 0); r += 1) {
  const row = ws.getRow(r);
  const ced = String(cellText(row.getCell(colCedula).value) || '').replace(/\D/g, '');
  const fromIndem = cellText(row.getCell(colSinIndem).value).trim();
  const currentSin = cellText(row.getCell(colSiniestro).value).trim();
  if (!fromIndem) continue;

  const digits = fromIndem.replace(/\D/g, '');
  if (digits.length < 6) continue;

  if (!currentSin || currentSin.replace(/\D/g, '') !== digits) {
    row.getCell(colSiniestro).value = digits;
    movedExcel += 1;
  }

  if (!ced) continue;
  const doc = byCed.get(ced);
  if (!doc) continue;

  const before = doc.toObject();
  if (String(doc.siniestro || '').replace(/\D/g, '') !== digits) {
    doc.siniestro = digits;
    await doc.save();
    updatedArnald += 1;
    try {
      await enqueueEquidadFdmExcelOutboundFromCaseUpdate(doc._id, before, doc.toObject());
    } catch {
      /* ignore */
    }
    if (samples.length < 8) samples.push({ ced, siniestro: digits });
  }
}

const outPath = path.resolve('C:/Users/GP-TI/Downloads/BASE_TERREMOTO_SINIESTRO_CORREGIDO.xlsx');
await wb.xlsx.writeFile(outPath);
const outBuf = fs.readFileSync(outPath);

const meta = await getItemMetadata(source.itemId);
try {
  const uploaded = await replaceDriveItemContentBuffer({
    driveId: source.driveId || driveId,
    itemId: source.itemId,
    buffer: outBuf,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ifMatch: meta.eTag,
  });
  source.eTag = uploaded?.eTag || meta.eTag;
  source.lastSyncAt = new Date();
  await source.save();
  console.log(
    JSON.stringify(
      { ok: true, movedExcel, updatedArnald, samples, eTag: source.eTag, outPath },
      null,
      2
    )
  );
} catch (err) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: err.code || err.message,
        movedExcel,
        updatedArnald,
        samples,
        outPath,
        hint: 'Cierra el Excel en SharePoint y reintenta',
      },
      null,
      2
    )
  );
}

await mongoose.disconnect();
