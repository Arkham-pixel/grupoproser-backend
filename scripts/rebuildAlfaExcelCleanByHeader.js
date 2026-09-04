/**
 * Regenera el consolidado operativo LIMPIO desde cero (amarillas):
 * - Conserva fila 1 (títulos, colores, orden) y columnas verdes A–S del Excel.
 * - Vacía T–AK (ARNALD) y las reescribe desde Mongo por ENCABEZADO.
 * - Solo filas que YA están en el Excel (Excel = maestro de filas).
 * - NO crea columnas nuevas. NO append de casos ARNALD ausentes.
 *
 * Uso:
 *   node scripts/rebuildAlfaExcelCleanByHeader.js
 *   node scripts/rebuildAlfaExcelCleanByHeader.js --dry-run
 *   node scripts/rebuildAlfaExcelCleanByHeader.js --no-upload
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
  ALFA_EXCEL_GREEN_COLUMNS,
  getOwnershipEntry,
  getOutboundWritableFields,
} from '../config/alfaExcelOwnershipMap.js';
import { ALFA_EXCEL_DATE_FIELDS, ALFA_EXCEL_MONEY_FIELDS } from '../config/alfaExcelColumnMap.js';
import { normalizeExcelHeader } from '../utils/alfaExcelNormalize.js';
import { applyAlfaExcelCellValue, getAlfaExcelDefaultNumFmt } from '../utils/alfaExcelCellFormat.js';
import { estadoAlfaParaSharePoint } from '../config/alfaExcelStatuses.js';
import { matchAlfaCaseForExcelRow, parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import {
  downloadDriveItemBuffer,
  getItemMetadata,
  listFolder,
  replaceDriveItemContentBuffer,
  uploadSmallFile,
} from '../services/microsoftGraphService.js';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';

const OPERATIVO = 'CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali.xlsx';
const DRY = process.argv.includes('--dry-run');
const NO_UPLOAD = process.argv.includes('--no-upload') || DRY;

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

function columnNumberToLetter(num) {
  let n = Number(num);
  if (!Number.isFinite(n) || n < 1) return '';
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function resolveCol(headerRow, entry) {
  const aliases = [entry?.header, ...(entry?.headerAliases || [])]
    .filter(Boolean)
    .map((h) => normalizeExcelHeader(h));
  const maxCol = Math.max(45, headerRow.cellCount || 0);
  for (let c = 1; c <= maxCol; c += 1) {
    const norm = normalizeExcelHeader(headerCellText(headerRow.getCell(c).value));
    if (norm && aliases.includes(norm)) return c;
  }
  return null;
}

function lastUsedCol(headerRow) {
  let last = 1;
  headerRow.eachCell({ includeEmpty: false }, (_cell, col) => {
    if (col > last) last = col;
  });
  return last;
}

function lastUsedRow(ws) {
  let last = 1;
  ws.eachRow({ includeEmpty: false }, (_r, n) => {
    if (n > last) last = n;
  });
  return last;
}

function toCellValue(field, value) {
  if (value == null || value === '') return null;
  if (field === 'estado') {
    const mapped = estadoAlfaParaSharePoint(value);
    return mapped || null;
  }
  if (ALFA_EXCEL_DATE_FIELDS.includes(field)) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    if (d.getUTCFullYear() < 2000) return null; // basura tipo 1899
    return d;
  }
  if (ALFA_EXCEL_MONEY_FIELDS.includes(field)) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

function refreshBdFrame(ws) {
  const headerRow = ws.getRow(1);
  const lastCol = lastUsedCol(headerRow);
  const lastRow = Math.max(2, lastUsedRow(ws));
  const ref = `A1:${columnNumberToLetter(lastCol)}${lastRow}`;
  ws.autoFilter = ref;
  ws.views = [
    {
      workbookViewId: 0,
      state: 'frozen',
      xSplit: 0,
      ySplit: 1,
      topLeftCell: 'A2',
      activeCell: 'A2',
      showRuler: true,
      showRowColHeaders: true,
      showGridLines: false,
      zoomScale: 85,
      zoomScaleNormal: 85,
    },
  ];
  return { ref, lastCol, lastRow };
}

await mongoose.connect(process.env.MONGO_URI);
const cfg = getAlfaExcelOutboundConfig();
const folder = cfg.rootPath || 'SEGUROS ALFA/CONTROL Y SEGUIMIENTO';
const yellowFields = getOutboundWritableFields();

// Pausar outbox mientras regeneramos
const far = new Date(Date.now() + 3 * 60 * 60 * 1000);
const paused = await AlfaExcelOutboundUpdate.updateMany(
  { status: { $in: ['pending', 'processing', 'failed'] } },
  {
    $set: {
      status: 'cancelled',
      lastError: 'superseded_by_clean_rebuild',
      lastErrorCode: 'SUPERSEDED',
      nextRetryAt: far,
    },
  }
);
console.log(JSON.stringify({ event: 'OUTBOX_PAUSED', n: paused.modifiedCount, dry: DRY }));

const listed = await listFolder(folder, { top: 50 });
const opItem = (listed.children || []).find((c) => c.name === OPERATIVO);
if (!opItem?.id) throw new Error('OPERATIVO_NOT_FOUND');

const opMeta = await getItemMetadata(opItem.id);
const dl = await downloadDriveItemBuffer({
  driveId: opMeta.parentReference.driveId,
  itemId: opItem.id,
});
const srcBuf = dl.buffer || dl;
console.log(JSON.stringify({ event: 'DOWNLOADED', bytes: srcBuf.length, name: opMeta.name }));

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(srcBuf);
const ws =
  wb.getWorksheet(ALFA_EXCEL_SHEET_NAME) ||
  wb.worksheets.find((w) => String(w.name).toUpperCase() === 'BD') ||
  wb.worksheets[0];
if (!ws) throw new Error('SHEET_BD_NOT_FOUND');

const headerRow = ws.getRow(1);
const lastCol = lastUsedCol(headerRow);
const lastRow = lastUsedRow(ws);

// Mapear campos ARNALD → columna por encabezado real
const fieldCols = {};
const missingHeaders = [];
for (const field of yellowFields) {
  const entry = getOwnershipEntry(field);
  const col = resolveCol(headerRow, entry);
  if (!col) {
    missingHeaders.push({ field, header: entry?.header });
    continue;
  }
  fieldCols[field] = col;
}

console.log(
  JSON.stringify({
    event: 'HEADER_MAP',
    lastCol,
    lastRow,
    mapped: Object.keys(fieldCols).length,
    missingHeaders,
    headers: Object.fromEntries(
      Object.entries(fieldCols).map(([f, c]) => [f, columnNumberToLetter(c)])
    ),
  })
);

if (missingHeaders.length) {
  throw new Error(`MISSING_HEADERS:${missingHeaders.map((m) => m.field).join(',')}`);
}

const greenSet = new Set(ALFA_EXCEL_GREEN_COLUMNS.map((l) => columnLetterToNumber(l)));
const yellowCols = [...new Set(Object.values(fieldCols))];

// 1) Limpiar SOLO columnas amarillas (conservar verdes A–S y encabezado)
let clearedCells = 0;
for (let r = 2; r <= lastRow; r += 1) {
  const row = ws.getRow(r);
  for (const col of yellowCols) {
    if (greenSet.has(col)) continue; // safety
    const cell = row.getCell(col);
    if (cell.value != null && cell.value !== '') {
      cell.value = null;
      clearedCells += 1;
    }
  }
}

// 2) Cargar ARNALD y matchear cada fila Excel → caso
const parsed = parseAlfaExcelBuffer(srcBuf);
const casos = await SegurosAlfaCaso.find({}).lean();
console.log(JSON.stringify({ event: 'ARNALD_LOADED', casos: casos.length, excelRows: parsed.rows.length }));

let matched = 0;
let unmatched = 0;
let ambiguous = 0;
let writtenCells = 0;
const unmatchedSample = [];

for (const excelRow of parsed.rows) {
  const rowNumber = excelRow.rowNumber;
  const match = matchAlfaCaseForExcelRow(excelRow.payload || {}, casos);
  if (match.actionHint === 'AMBIGUOUS') {
    ambiguous += 1;
    continue;
  }
  if (match.actionHint !== 'MATCH' || !match.cases?.[0]) {
    unmatched += 1;
    if (unmatchedSample.length < 15) {
      unmatchedSample.push({
        row: rowNumber,
        id: excelRow.payload?.identificacion || null,
        aseg: excelRow.payload?.asegurado || null,
      });
    }
    continue;
  }

  const caso = match.cases[0];
  const row = ws.getRow(rowNumber);
  matched += 1;

  for (const field of yellowFields) {
    const col = fieldCols[field];
    if (!col) continue;
    const val = toCellValue(field, caso[field]);
    if (val == null || val === '') continue;
    const cell = row.getCell(col);
    applyAlfaExcelCellValue(cell, field, val, {
      numFmt: getAlfaExcelDefaultNumFmt(field),
    });
    writtenCells += 1;
  }
}

const frame = refreshBdFrame(ws);
console.log(
  JSON.stringify({
    event: 'REBUILD_STATS',
    clearedCells,
    matched,
    unmatched,
    ambiguous,
    writtenCells,
    frame,
    unmatchedSample,
  })
);

const outBuf = Buffer.from(await wb.xlsx.writeBuffer());
const localPath = path.resolve(
  process.env.USERPROFILE || '.',
  'Downloads',
  'CONSOLIDADO-TERREMOTO-AGOSTO-2026-FAC-Cali_LIMPIO.xlsx'
);
fs.writeFileSync(localPath, outBuf);
console.log(JSON.stringify({ event: 'SAVED_LOCAL', path: localPath, bytes: outBuf.length }));

if (NO_UPLOAD) {
  console.log(JSON.stringify({ event: 'SKIP_UPLOAD', reason: DRY ? 'dry-run' : 'no-upload' }));
  await mongoose.disconnect();
  process.exit(0);
}

let ok = false;
let lastErr = null;
for (let attempt = 1; attempt <= 10; attempt += 1) {
  try {
    const up = await uploadSmallFile(folder, OPERATIVO, outBuf, {
      conflictBehavior: 'replace',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    ok = true;
    console.log(JSON.stringify({ event: 'UPLOAD_OK', attempt, id: up?.id }));
    break;
  } catch (e) {
    lastErr = e;
    console.warn(JSON.stringify({ event: 'UPLOAD_FAIL', attempt, error: e.code || e.message }));
    try {
      const meta = await getItemMetadata(opItem.id);
      await replaceDriveItemContentBuffer({
        driveId: meta.parentReference?.driveId,
        itemId: opItem.id,
        buffer: outBuf,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      ok = true;
      console.log(JSON.stringify({ event: 'REPLACE_OK', attempt }));
      break;
    } catch (e2) {
      lastErr = e2;
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
  }
}

if (!ok) {
  console.error(JSON.stringify({ event: 'UPLOAD_FAILED', error: lastErr?.message || String(lastErr) }));
  console.error('Archivo limpio quedó en Downloads; cierra Excel en SharePoint y reintenta upload.');
  await mongoose.disconnect();
  process.exit(1);
}

await mongoose.disconnect();
console.log(JSON.stringify({ event: 'DONE', localPath, matched, unmatched, ambiguous, writtenCells }));
