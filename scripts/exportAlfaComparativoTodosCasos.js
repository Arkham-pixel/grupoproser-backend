/**
 * SOLO LECTURA / COPIA LOCAL.
 * Genera un Excel comparativo con TODOS los casos Alfa en Mongo
 * (activos + soft-archivados), sin tocar SharePoint ni modificar ARNALD.
 *
 *   node scripts/exportAlfaComparativoTodosCasos.js
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import {
  ALFA_EXCEL_APPEND_FIELDS,
  getOwnershipEntry,
} from '../config/alfaExcelOwnershipMap.js';
import {
  ALFA_EXCEL_DATE_FIELDS,
  ALFA_EXCEL_MONEY_FIELDS,
} from '../config/alfaExcelColumnMap.js';
import { normalizeExcelHeader } from '../utils/alfaExcelNormalize.js';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';
import {
  downloadDriveItemBuffer,
  getItemMetadata,
} from '../services/microsoftGraphService.js';

function toExcelCellValue(field, value) {
  if (value == null || value === '') return null;
  if (ALFA_EXCEL_DATE_FIELDS.includes(field)) {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
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
    if (Array.isArray(value.richText)) {
      return value.richText.map((p) => p.text || '').join('');
    }
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

function letterFromCol(n) {
  let x = n;
  let s = '';
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

await mongoose.connect(process.env.MONGO_URI);

const all = await SegurosAlfaCaso.find({})
  .sort({ createdAt: 1, consecutivo: 1 })
  .lean();

const active = all.filter((c) => c.excluidoBaseAlfa !== true);
const archived = all.filter((c) => c.excluidoBaseAlfa === true);

console.log(
  JSON.stringify({
    event: 'COUNTS',
    total: all.length,
    active: active.length,
    archived: archived.length,
    note: 'Solo copia local. No se modifica SharePoint ni Mongo.',
  })
);

// Tomar encabezados del consolidado actual (solo lectura)
const cfg = getAlfaExcelOutboundConfig();
const source = await AlfaExcelSharePointSource.findOne({
  integrationKey: cfg.integrationKey || 'alfa-excel-control-seguimiento',
}).lean();

const meta = await getItemMetadata(source.itemId);
const driveId = meta.parentReference?.driveId || source.driveId;
const dl = await downloadDriveItemBuffer({ driveId, itemId: source.itemId });
const opBuf = dl.buffer || dl;

const wbIn = new ExcelJS.Workbook();
await wbIn.xlsx.load(opBuf);
const wsIn =
  wbIn.getWorksheet('BD') ||
  wbIn.worksheets.find((w) => String(w.name).toUpperCase() === 'BD') ||
  wbIn.worksheets[0];
const headerIn = wsIn.getRow(1);

const outWb = new ExcelJS.Workbook();
const outWs = outWb.addWorksheet(wsIn.name || 'BD');
headerIn.eachCell({ includeEmpty: true }, (cell, col) => {
  outWs.getRow(1).getCell(col).value = cell.value;
});

// Columna extra al final para marcar origen
let lastCol = 1;
outWs.getRow(1).eachCell({ includeEmpty: false }, (_c, col) => {
  if (col > lastCol) lastCol = col;
});
const flagCol = lastCol + 1;
outWs.getRow(1).getCell(flagCol).value = 'ESTADO_BASE_ARNALD';
outWs.getRow(1).getCell(flagCol + 1).value = 'CONSECUTIVO_ARNALD';
outWs.getRow(1).getCell(flagCol + 2).value = 'MOTIVO_EXCLUSION';

const outHeader = outWs.getRow(1);
let rowIdx = 2;

for (const caso of all) {
  const excelRow = outWs.getRow(rowIdx);
  for (const field of ALFA_EXCEL_APPEND_FIELDS) {
    const entry = getOwnershipEntry(field);
    if (!entry) continue;
    const val = toExcelCellValue(field, caso[field]);
    if (val == null || val === '') continue;
    const col = resolveCol(outHeader, entry);
    if (!col) continue;
    excelRow.getCell(col).value = val;
  }
  excelRow.getCell(flagCol).value =
    caso.excluidoBaseAlfa === true ? 'ARCHIVADO_SOFT' : 'ACTIVO';
  excelRow.getCell(flagCol + 1).value = caso.consecutivo || '';
  excelRow.getCell(flagCol + 2).value =
    caso.excluidoBaseAlfa === true
      ? caso.excluidoBaseAlfaReason || 'no_en_base_limpia'
      : '';
  rowIdx += 1;
}

outWs.autoFilter = `A1:${letterFromCol(flagCol + 2)}${Math.max(2, rowIdx - 1)}`;

const outBuf = Buffer.from(await outWb.xlsx.writeBuffer());
const stamp = new Date().toISOString().slice(0, 10);
const outPath = path.join(
  process.env.USERPROFILE || '.',
  'Downloads',
  `COMPARATIVO-ALFA-TODOS-CASOS-ARNALD_${stamp}_${all.length}-filas.xlsx`
);
fs.writeFileSync(outPath, outBuf);

console.log(
  JSON.stringify(
    {
      event: 'DONE',
      path: outPath,
      bytes: outBuf.length,
      dataRows: rowIdx - 2,
      active: active.length,
      archived: archived.length,
      sharepointTouched: false,
      mongoModified: false,
    },
    null,
    2
  )
);

await mongoose.disconnect();
