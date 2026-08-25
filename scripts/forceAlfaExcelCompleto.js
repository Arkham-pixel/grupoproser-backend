/**
 * Fuerza consolidado completo en SharePoint (1634 casos ARNALD).
 * Si el archivo operativo está bloqueado, sube *_COMPLETO.xlsx y re-apunta ARNALD.
 *
 * node scripts/forceAlfaExcelCompleto.js
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import {
  ALFA_EXCEL_SHEET_NAME,
  ALFA_EXCEL_APPEND_FIELDS,
  getOwnershipEntry,
} from '../config/alfaExcelOwnershipMap.js';
import { ALFA_EXCEL_DATE_FIELDS, ALFA_EXCEL_MONEY_FIELDS } from '../config/alfaExcelColumnMap.js';
import { normalizeExcelHeader } from '../utils/alfaExcelNormalize.js';
import { normalizeIdentification as normId } from '../utils/alfaIdentification.js';
import {
  findExcelRowForCase,
} from '../services/alfaExcelOutboundService.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import {
  downloadDriveItemBuffer,
  getItemMetadata,
  replaceDriveItemContentBuffer,
  uploadSmallFile,
} from '../services/microsoftGraphService.js';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';

function toExcelCellValue(field, value) {
  if (value == null || value === '') return null;
  if (ALFA_EXCEL_DATE_FIELDS.includes(field)) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }
  if (ALFA_EXCEL_MONEY_FIELDS.includes(field)) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

function headerCellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
  }
  return String(value);
}

function columnLetterToNumber(letter) {
  const s = String(letter || '').toUpperCase();
  let n = 0;
  for (let i = 0; i < s.length; i += 1) n = n * 26 + (s.charCodeAt(i) - 64);
  return n;
}

function resolveCol(headerRow, entry) {
  const aliases = [entry?.header, ...(entry?.headerAliases || [])]
    .filter(Boolean)
    .map((h) => normalizeExcelHeader(h));
  const maxCol = Math.max(40, headerRow.cellCount || 0);
  for (let c = 1; c <= maxCol; c += 1) {
    const norm = normalizeExcelHeader(headerCellText(headerRow.getCell(c).value));
    if (norm && aliases.includes(norm)) return c;
  }
  return entry?.column ? columnLetterToNumber(entry.column) : null;
}

function nextRow(ws) {
  let last = 1;
  ws.eachRow({ includeEmpty: false }, (_r, n) => {
    if (n > last) last = n;
  });
  return Math.max(2, last + 1);
}

await mongoose.connect(process.env.MONGO_URI);

const far = new Date(Date.now() + 4 * 60 * 60 * 1000);
await AlfaExcelOutboundUpdate.updateMany(
  { status: { $in: ['pending', 'processing', 'retry'] } },
  { $set: { status: 'pending', nextRetryAt: far } }
);

const cfg = getAlfaExcelOutboundConfig();
const source = await AlfaExcelSharePointSource.findOne({
  integrationKey: cfg.integrationKey,
});
if (!source?.itemId) throw new Error('SOURCE_NOT_CONFIGURED');

const meta = await getItemMetadata(source.itemId);
const driveId = meta.parentReference?.driveId || source.driveId;
console.log('source', meta.name, 'size', meta.size);

const dl = await downloadDriveItemBuffer({ driveId, itemId: source.itemId });
const buffer = dl.buffer || dl;
const parsed = parseAlfaExcelBuffer(buffer);
const excelRows = parsed.rows || [];
console.log('excel_rows_before', excelRows.length);

const casos = await SegurosAlfaCaso.find({}).lean();
console.log('casos_arnald', casos.length);

const missing = [];
for (const caso of casos) {
  const id = normId(caso.identificacion);
  if (!id || String(id).length < 5) continue;
  try {
    findExcelRowForCase(caso, excelRows);
  } catch (e) {
    if (e?.code === 'EXCEL_ROW_NOT_FOUND') missing.push(caso);
  }
}
console.log('missing_to_append', missing.length);

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);
const ws =
  wb.getWorksheet(parsed.sheetName || ALFA_EXCEL_SHEET_NAME) ||
  wb.worksheets.find((w) => String(w.name).toUpperCase() === 'BD') ||
  wb.worksheets[0];
const headerRow = ws.getRow(1);
let rowIdx = nextRow(ws);
for (const caso of missing) {
  const row = ws.getRow(rowIdx);
  for (const field of ALFA_EXCEL_APPEND_FIELDS) {
    const entry = getOwnershipEntry(field);
    if (!entry) continue;
    const val = toExcelCellValue(field, caso[field]);
    if (val == null || val === '') continue;
    const col = resolveCol(headerRow, entry);
    if (!col) continue;
    row.getCell(col).value = val;
  }
  rowIdx += 1;
}

{
  const lastCol = (() => {
    let last = 1;
    headerRow.eachCell({ includeEmpty: false }, (_c, col) => {
      if (col > last) last = col;
    });
    return last;
  })();
  const lastRow = Math.max(2, rowIdx - 1);
  const letter = (n) => {
    let x = n;
    let s = '';
    while (x > 0) {
      const rem = (x - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  };
  ws.autoFilter = `A1:${letter(lastCol)}${lastRow}`;
}

const outBuf = Buffer.from(await wb.xlsx.writeBuffer());
const localPath = path.resolve(
  process.env.USERPROFILE || '.',
  'Downloads',
  'CONSOLIDADO-TERREMOTO-AGOSTO-2026-FAC-Cali_COMPLETO.xlsx'
);
fs.writeFileSync(localPath, outBuf);
console.log('saved_local', localPath, 'bytes', outBuf.length);

const folder = cfg.rootPath || 'SEGUROS ALFA/CONTROL Y SEGUIMIENTO';
const operativo = 'CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali.xlsx';
const completo = 'CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali_COMPLETO.xlsx';

let uploadedName = operativo;
let uploadedItem = null;
try {
  const metaBefore = await getItemMetadata(source.itemId);
  uploadedItem = await replaceDriveItemContentBuffer({
    driveId,
    itemId: source.itemId,
    buffer: outBuf,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ifMatch: metaBefore.eTag,
  });
  console.log('replaced_operativo_ok');
} catch (e) {
  console.warn('replace_operativo_fail', e.code || e.message);
  uploadedItem = await uploadSmallFile(folder, completo, outBuf, {
    conflictBehavior: 'replace',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  uploadedName = uploadedItem?.name || completo;
  console.log('uploaded_completo', uploadedName, uploadedItem?.id);

  // Re-apuntar checkpoint al archivo completo
  source.itemId = uploadedItem.id;
  source.fileName = uploadedName;
  source.eTag = uploadedItem.eTag;
  source.lastArnaldWrittenEtag = uploadedItem.eTag;
  source.driveId = driveId;
  await source.save();
}

// Verificar
const verifyId = uploadedItem?.id || source.itemId;
const verifyMeta = await getItemMetadata(verifyId);
const verifyDl = await downloadDriveItemBuffer({
  driveId: verifyMeta.parentReference?.driveId || driveId,
  itemId: verifyId,
});
const verifyParsed = parseAlfaExcelBuffer(verifyDl.buffer || verifyDl);

console.log(
  JSON.stringify(
    {
      ok: true,
      fileName: verifyMeta.name,
      rowsBefore: excelRows.length,
      appended: missing.length,
      rowsAfter: verifyParsed.rows?.length ?? null,
      localCopy: localPath,
      note:
        verifyMeta.name.includes('_COMPLETO')
          ? 'El operativo estaba bloqueado; ARNALD quedó apuntando al *_COMPLETO.xlsx'
          : 'Se actualizó el consolidado operativo',
    },
    null,
    2
  )
);

await mongoose.disconnect();
