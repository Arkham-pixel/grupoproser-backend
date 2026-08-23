/**
 * Escribe columnas amarillas ARNALD → Excel consolidado Final (local).
 * Asume que el import ya corrió.
 *
 * node scripts/pushArnaldToAlfaConsolidadoFinal.js
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import { findExcelRowForCase } from '../services/alfaExcelOutboundService.js';
import {
  getOutboundWritableFields,
  getOwnershipEntry,
  assertFieldWritableOrThrow,
} from '../config/alfaExcelOwnershipMap.js';
import { ALFA_EXCEL_DATE_FIELDS, ALFA_EXCEL_MONEY_FIELDS } from '../config/alfaExcelColumnMap.js';
import {
  isAlfaOutboundEmptyValue,
  normalizeExcelHeader,
} from '../utils/alfaExcelNormalize.js';

const EXCEL_PATH = path.resolve(
  'C:/Users/GP-TI/Downloads/EQUIDAD/CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali_Final.xlsx'
);
const OUT_PATH = path.resolve(
  'C:/Users/GP-TI/Downloads/EQUIDAD/CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali_Final_ARNALD.xlsx'
);

function columnNumberToLetter(num) {
  let n = Number(num);
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
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

function buildHeaderColMap(headerRow) {
  const map = new Map();
  const maxCol = Math.max(40, headerRow.cellCount || 0);
  for (let c = 1; c <= maxCol; c += 1) {
    const norm = normalizeExcelHeader(headerCellText(headerRow.getCell(c).value));
    if (norm) map.set(norm, c);
  }
  return map;
}

function resolveFieldCol(headerMap, entry) {
  const aliases = [
    entry?.header,
    ...(Array.isArray(entry?.headerAliases) ? entry.headerAliases : []),
  ]
    .filter(Boolean)
    .map((h) => normalizeExcelHeader(h));
  for (const a of aliases) {
    if (headerMap.has(a)) return headerMap.get(a);
  }
  return null;
}

await mongoose.connect(process.env.MONGO_URI);
const buffer = fs.readFileSync(EXCEL_PATH);
const parsed = parseAlfaExcelBuffer(buffer);
const casos = await SegurosAlfaCaso.find().lean();
const writableFields = getOutboundWritableFields();

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);
const ws =
  wb.getWorksheet(parsed.sheetName) ||
  wb.worksheets.find((w) => String(w.name).toUpperCase() === 'BD');
if (!ws) throw new Error('HOJA_BD_NO_ENCONTRADA');

const headerMap = buildHeaderColMap(ws.getRow(1));
const fieldCols = {};
for (const field of writableFields) {
  const entry = getOwnershipEntry(field);
  assertFieldWritableOrThrow(field);
  const col = resolveFieldCol(headerMap, entry);
  if (!col) {
    console.warn('SIN_COLUMNA', field, entry?.header);
    continue;
  }
  fieldCols[field] = col;
  console.log(`col ${field} → ${columnNumberToLetter(col)}`);
}

let matched = 0;
let patchedRows = 0;
let cellsWritten = 0;
let unmatched = 0;
let ambiguous = 0;

for (const caso of casos) {
  let hit = null;
  try {
    hit = findExcelRowForCase(caso, parsed.rows);
  } catch (e) {
    if (e.code === 'AMBIGUOUS_EXCEL_ROW') {
      ambiguous += 1;
      continue;
    }
    if (e.code === 'EXCEL_ROW_NOT_FOUND') {
      unmatched += 1;
      continue;
    }
    throw e;
  }
  if (!hit?.rowNumber) {
    unmatched += 1;
    continue;
  }
  matched += 1;
  const row = ws.getRow(hit.rowNumber);
  let wrote = false;
  for (const field of writableFields) {
    const col = fieldCols[field];
    if (!col) continue;
    const val = caso[field];
    if (isAlfaOutboundEmptyValue(val)) continue;
    const cell = row.getCell(col);
    cell.value = toExcelCellValue(field, val);
    if (ALFA_EXCEL_DATE_FIELDS.includes(field) && cell.value instanceof Date) {
      cell.numFmt = 'dd/mm/yyyy';
    }
    cellsWritten += 1;
    wrote = true;
  }
  if (wrote) patchedRows += 1;
}

const outBuf = Buffer.from(await wb.xlsx.writeBuffer());
fs.writeFileSync(OUT_PATH, outBuf);
const bak = EXCEL_PATH.replace(/\.xlsx$/i, `_BACKUP_${Date.now()}.xlsx`);
fs.copyFileSync(EXCEL_PATH, bak);
fs.writeFileSync(EXCEL_PATH, outBuf);

console.log(
  JSON.stringify(
    {
      matched,
      unmatched,
      ambiguous,
      patchedRows,
      cellsWritten,
      casosArnald: casos.length,
      excelRows: parsed.rows.length,
      outPath: OUT_PATH,
      backup: bak,
      overwrittenOriginal: EXCEL_PATH,
      bytes: outBuf.length,
    },
    null,
    2
  )
);

await mongoose.disconnect();
console.log('OK');
