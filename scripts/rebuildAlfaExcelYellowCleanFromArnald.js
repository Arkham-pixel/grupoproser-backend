/**
 * Regenera el consolidado FAC-Cali “desde cero” en columnas amarillas ARNALD:
 * - Conserva fila 1 (títulos, colores, orden) y columnas verdes Alfa (A–S)
 * - Vacía T–AK (amarillas) y las reescribe desde Mongo ARNALD por encabezado
 * - Guarda copia local limpia + reemplaza el operativo en SharePoint
 *
 * node scripts/rebuildAlfaExcelYellowCleanFromArnald.js
 * node scripts/rebuildAlfaExcelYellowCleanFromArnald.js --local-only
 * node scripts/rebuildAlfaExcelYellowCleanFromArnald.js --from-local="C:/Users/.../file.xlsx"
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import {
  ALFA_EXCEL_SHEET_NAME,
  ALFA_EXCEL_OWNERSHIP,
  getOutboundWritableFields,
  getOwnershipEntry,
} from '../config/alfaExcelOwnershipMap.js';
import { ALFA_EXCEL_DATE_FIELDS, ALFA_EXCEL_MONEY_FIELDS } from '../config/alfaExcelColumnMap.js';
import { normalizeExcelHeader, pesosOficialesAlfa } from '../utils/alfaExcelNormalize.js';
import {
  applyAlfaExcelCellValue,
  getAlfaExcelDefaultNumFmt,
} from '../utils/alfaExcelCellFormat.js';
import { estadoAlfaParaSharePoint } from '../config/alfaExcelStatuses.js';
import {
  parseAlfaExcelBuffer,
  matchAlfaCaseForExcelRow,
} from '../services/alfaExcelImportService.js';
import {
  resetMicrosoftGraphClient,
  getAccessToken,
  downloadDriveItemBuffer,
  getItemMetadata,
  resolveDriveContext,
  replaceDriveItemContentBuffer,
} from '../services/microsoftGraphService.js';
import { selectAlfaExcelFromSharePointFolder } from '../services/alfaExcelSharePointImportService.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';

const YELLOW_FIELDS = getOutboundWritableFields();
const LOCAL_OUT = path.join(
  process.env.USERPROFILE || process.env.HOME || '.',
  'Downloads',
  'CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali_LIMPIO.xlsx'
);

function argFlag(name) {
  return process.argv.includes(name);
}
function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
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

function resolveFieldCol(headerRow, field) {
  const entry = getOwnershipEntry(field);
  if (!entry) return null;
  const aliases = [entry.header, ...(entry.headerAliases || [])]
    .filter(Boolean)
    .map((h) => normalizeExcelHeader(h));
  const maxCol = Math.max(45, headerRow.cellCount || 0);
  for (let c = 1; c <= maxCol; c += 1) {
    const norm = normalizeExcelHeader(headerCellText(headerRow.getCell(c).value));
    if (norm && aliases.includes(norm)) return c;
  }
  return null;
}

function isValidArnaldDate(value) {
  if (value == null || value === '') return false;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const y = d.getUTCFullYear();
  return y >= 2000 && y <= 2100;
}

function toCellValue(field, value) {
  if (value == null || value === '') return null;
  if (field === 'estado') {
    return estadoAlfaParaSharePoint(value) || null;
  }
  if (ALFA_EXCEL_DATE_FIELDS.includes(field)) {
    if (!isValidArnaldDate(value)) return null;
    const d = value instanceof Date ? value : new Date(value);
    return d;
  }
  if (ALFA_EXCEL_MONEY_FIELDS.includes(field)) {
    if (value instanceof Date) return null;
    const n = pesosOficialesAlfa(value);
    if (n == null || !Number.isFinite(n)) return null;
    // Evitar seriales Excel / basura (años como montos, etc.)
    if (n < 0 || n > 1e11) return null;
    if (Number.isInteger(n) && n > 1900 && n < 2100) return null;
    return n;
  }
  const s = String(value).trim();
  return s || null;
}

function lastDataRow(ws) {
  let last = 1;
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n > last) last = n;
  });
  return last;
}

await mongoose.connect(process.env.MONGO_URI);

const localOnly = argFlag('--local-only');
const fromLocal = argValue('--from-local=');

let sourceBuffer;
let driveId = null;
let itemId = null;
let eTagBefore = null;
let sourceName = null;

if (fromLocal) {
  sourceBuffer = fs.readFileSync(fromLocal);
  sourceName = path.basename(fromLocal);
  console.log(JSON.stringify({ event: 'LOADED_LOCAL', file: fromLocal, bytes: sourceBuffer.length }));
} else {
  resetMicrosoftGraphClient();
  await getAccessToken();
  const cfg = getAlfaExcelSharePointImportConfig();
  const ctx = await resolveDriveContext();
  driveId = ctx.driveId;
  const sel = await selectAlfaExcelFromSharePointFolder(cfg.rootPath, cfg.fileName);
  const meta = await getItemMetadata(sel.selected.itemId);
  itemId = meta.id;
  eTagBefore = meta.eTag;
  sourceName = sel.selected.name;
  const dl = await downloadDriveItemBuffer({ driveId, itemId });
  sourceBuffer = dl.buffer;
  console.log(
    JSON.stringify({
      event: 'DOWNLOADED_SHAREPOINT',
      file: sourceName,
      bytes: sourceBuffer.length,
      eTag: eTagBefore,
    })
  );
}

const parsed = parseAlfaExcelBuffer(sourceBuffer);
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(sourceBuffer);
const ws =
  wb.getWorksheet(ALFA_EXCEL_SHEET_NAME) ||
  wb.worksheets.find((w) => String(w.name).trim().toUpperCase() === 'BD') ||
  wb.worksheets[0];
if (!ws) throw new Error('NO_SHEET_BD');

const headerRow = ws.getRow(1);
const fieldCols = {};
const missingHeaders = [];
for (const field of YELLOW_FIELDS) {
  const col = resolveFieldCol(headerRow, field);
  if (!col) missingHeaders.push({ field, header: ALFA_EXCEL_OWNERSHIP[field]?.header });
  else fieldCols[field] = col;
}
if (missingHeaders.length) {
  console.log(JSON.stringify({ event: 'MISSING_HEADERS', missingHeaders }));
  throw new Error('MISSING_YELLOW_HEADERS');
}

const yellowColNums = [...new Set(Object.values(fieldCols))];
const maxRow = Math.max(lastDataRow(ws), ...parsed.rows.map((r) => r.rowNumber));

console.log(
  JSON.stringify({
    event: 'PLAN',
    sheet: ws.name,
    maxRow,
    yellowCols: yellowColNums.length,
    excelRows: parsed.rows.length,
    fields: YELLOW_FIELDS.length,
  })
);

// 1) Limpiar todas las amarillas (dejar verdes + encabezados intactos)
for (let r = 2; r <= maxRow; r += 1) {
  const row = ws.getRow(r);
  for (const col of yellowColNums) {
    const cell = row.getCell(col);
    cell.value = null;
  }
}

// 2) Cargar ARNALD y alimentar por match
const casos = await SegurosAlfaCaso.find({})
  .select(
    [
      '_id',
      'consecutivo',
      'siniestro',
      'identificacion',
      'numeroPoliza',
      'numeroCredito',
      'direccionPredio',
      'fechaSiniestro',
      ...YELLOW_FIELDS,
    ].join(' ')
  )
  .lean();

let matched = 0;
let unmatched = 0;
let ambiguous = 0;
let cellsWritten = 0;
const unmatchedSample = [];

for (const excelRow of parsed.rows) {
  const match = matchAlfaCaseForExcelRow(excelRow.payload || {}, casos);
  if (match.actionHint === 'AMBIGUOUS') {
    ambiguous += 1;
    continue;
  }
  if (match.actionHint !== 'MATCH' || !match.cases?.length) {
    unmatched += 1;
    if (unmatchedSample.length < 15) {
      unmatchedSample.push({
        row: excelRow.rowNumber,
        id: excelRow.payload?.identificacion || null,
        siniestro: excelRow.payload?.siniestro || null,
      });
    }
    continue;
  }
  const caso = match.cases[0];
  matched += 1;
  const dataRow = ws.getRow(excelRow.rowNumber);
  for (const field of YELLOW_FIELDS) {
    const col = fieldCols[field];
    if (!col) continue;
    const val = toCellValue(field, caso[field]);
    if (val == null || val === '') continue;
    const cell = dataRow.getCell(col);
    const numFmt = getAlfaExcelDefaultNumFmt(field);
    applyAlfaExcelCellValue(cell, field, val, { numFmt });
    cellsWritten += 1;
  }
}

const outBuf = await wb.xlsx.writeBuffer();
const outBytes = Buffer.from(outBuf);
fs.mkdirSync(path.dirname(LOCAL_OUT), { recursive: true });
fs.writeFileSync(LOCAL_OUT, outBytes);
console.log(
  JSON.stringify({
    event: 'SAVED_LOCAL',
    path: LOCAL_OUT,
    bytes: outBytes.length,
    matched,
    unmatched,
    ambiguous,
    cellsWritten,
    unmatchedSample,
  })
);

if (!localOnly && !fromLocal) {
  const uploaded = await replaceDriveItemContentBuffer({
    driveId,
    itemId,
    buffer: outBytes,
    ifMatch: eTagBefore,
  });
  console.log(
    JSON.stringify({
      event: 'UPLOADED_SHAREPOINT',
      file: sourceName,
      eTagAfter: uploaded?.eTag || null,
      size: outBytes.length,
    })
  );
} else if (!localOnly && fromLocal) {
  // Subir el limpio generado desde un local hacia SharePoint vivo
  resetMicrosoftGraphClient();
  await getAccessToken();
  const cfg = getAlfaExcelSharePointImportConfig();
  const ctx = await resolveDriveContext();
  const sel = await selectAlfaExcelFromSharePointFolder(cfg.rootPath, cfg.fileName);
  const meta = await getItemMetadata(sel.selected.itemId);
  const uploaded = await replaceDriveItemContentBuffer({
    driveId: ctx.driveId,
    itemId: meta.id,
    buffer: outBytes,
    ifMatch: meta.eTag,
  });
  console.log(
    JSON.stringify({
      event: 'UPLOADED_SHAREPOINT_FROM_LOCAL',
      file: sel.selected.name,
      eTagAfter: uploaded?.eTag || null,
    })
  );
}

const cancelled = await AlfaExcelOutboundUpdate.updateMany(
  { status: { $in: ['pending', 'processing', 'failed'] } },
  {
    $set: {
      status: 'cancelled',
      lastError: 'superseded_by_yellow_clean_rebuild',
      lastErrorCode: 'SUPERSEDED',
      nextRetryAt: null,
    },
  }
);

console.log(
  JSON.stringify({
    done: true,
    localCopy: LOCAL_OUT,
    cancelledOutbox: cancelled.modifiedCount,
    note: 'headers_and_green_preserved_yellow_from_arnald',
  })
);

await mongoose.disconnect();
