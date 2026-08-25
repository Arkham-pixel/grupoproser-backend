/**
 * Repara FAC-Cali.xlsx operativo:
 * - Estructura de columnas = Final (A–AF), sin tocar *_Final.xlsx
 * - AutoFilter / “cuadro” cubre todas las filas y columnas
 * - Append de casos ARNALD faltantes
 * - Congela fila de encabezados
 *
 * node scripts/repairAlfaExcelOperativoFromFinal.js
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
import { findExcelRowForCase } from '../services/alfaExcelOutboundService.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import {
  downloadDriveItemBuffer,
  getItemMetadata,
  listFolder,
  replaceDriveItemContentBuffer,
  uploadSmallFile,
} from '../services/microsoftGraphService.js';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';
import {
  isAlfaExcelFinalProtectedName,
  toAlfaExcelOperationalFileName,
} from '../utils/alfaExcelSharePointPath.js';

const OPERATIVO = 'CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali.xlsx';
const FINAL = 'CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali_Final.xlsx';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  const maxCol = Math.max(40, headerRow.cellCount || 0);
  for (let c = 1; c <= maxCol; c += 1) {
    const norm = normalizeExcelHeader(headerCellText(headerRow.getCell(c).value));
    if (norm && aliases.includes(norm)) return c;
  }
  return entry?.column ? columnLetterToNumber(entry.column) : null;
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

/** Amplía el “cuadro” (AutoFilter) a todas las columnas con encabezado y todas las filas. */
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

  // Evitar columnas gigantes / fuera de marco usable
  const dirCol = resolveCol(headerRow, getOwnershipEntry('direccionPredio')) || 7;
  const dir = ws.getColumn(dirCol);
  if (dir.width && dir.width > 45) dir.width = 42;

  for (let c = 1; c <= lastCol; c += 1) {
    const col = ws.getColumn(c);
    // Montos cortos (RESERVA / VALOR…) no deben mostrar #####
    const header = normalizeExcelHeader(headerCellText(headerRow.getCell(c).value));
    if (
      /^(RESERVA|VALOR )/i.test(header) &&
      (!col.width || col.width < 14)
    ) {
      col.width = 16;
    }
  }

  // Evitar filas explosivas por wrap en dirección
  for (let r = 2; r <= lastRow; r += 1) {
    const row = ws.getRow(r);
    const addr = row.getCell(dirCol);
    if (addr?.alignment?.wrapText) {
      addr.alignment = { ...addr.alignment, wrapText: false, vertical: 'middle' };
    }
    if (row.height && row.height > 30) row.height = 18;
  }

  return { ref, lastCol, lastRow };
}

await mongoose.connect(process.env.MONGO_URI);
const cfg = getAlfaExcelOutboundConfig();
const folder = cfg.rootPath || 'SEGUROS ALFA/CONTROL Y SEGUIMIENTO';

if (isAlfaExcelFinalProtectedName(FINAL)) {
  // OK — solo lo usamos como plantilla de lectura
}

const far = new Date(Date.now() + 2 * 60 * 60 * 1000);
await AlfaExcelOutboundUpdate.updateMany(
  { status: { $in: ['pending', 'processing', 'retry'] } },
  { $set: { status: 'pending', nextRetryAt: far } }
);

const listed = await listFolder(folder, { top: 50 });
const finalItem = (listed.children || []).find((c) => c.name === FINAL);
const opItem = (listed.children || []).find((c) => c.name === OPERATIVO);
if (!finalItem?.id) throw new Error('FINAL_NOT_FOUND');
if (!opItem?.id) throw new Error('OPERATIVO_NOT_FOUND');

const finalMeta = await getItemMetadata(finalItem.id);
const finalDl = await downloadDriveItemBuffer({
  driveId: finalMeta.parentReference.driveId,
  itemId: finalItem.id,
});
const finalBuf = finalDl.buffer || finalDl;
console.log('template_final_bytes', finalBuf.length, 'name', finalMeta.name);

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(finalBuf);
const ws =
  wb.getWorksheet(ALFA_EXCEL_SHEET_NAME) ||
  wb.worksheets.find((w) => String(w.name).toUpperCase() === 'BD') ||
  wb.worksheets[0];
if (!ws) throw new Error('SHEET_BD_NOT_FOUND');

const parsed = parseAlfaExcelBuffer(finalBuf);
const excelRows = parsed.rows || [];
console.log('final_rows', excelRows.length, 'autoFilter_before', ws.autoFilter);

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

const headerRow = ws.getRow(1);
let rowIdx = lastUsedRow(ws) + 1;
if (rowIdx < 2) rowIdx = 2;

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

const frame = refreshBdFrame(ws);
console.log('frame', frame);

const outBuf = Buffer.from(await wb.xlsx.writeBuffer());
const localPath = path.resolve(
  process.env.USERPROFILE || '.',
  'Downloads',
  'CONSOLIDADO-TERREMOTO-AGOSTO-2026-FAC-Cali_REPARADO.xlsx'
);
fs.writeFileSync(localPath, outBuf);
console.log('saved_local', localPath, outBuf.length);

let ok = false;
let lastErr = null;
for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    const up = await uploadSmallFile(folder, OPERATIVO, outBuf, {
      conflictBehavior: 'replace',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    ok = true;
    console.log('upload_replace_ok', attempt, up?.id);
    break;
  } catch (e) {
    lastErr = e;
    console.warn('upload_fail', attempt, e.code || e.message);
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
      console.log('replace_item_ok', attempt);
      break;
    } catch (e2) {
      lastErr = e2;
      console.warn('replace_fail', attempt, e2.code || e2.message);
    }
    await sleep(10000);
  }
}

if (!ok) {
  console.error(
    JSON.stringify({
      ok: false,
      error: lastErr?.code || lastErr?.message,
      hint: 'Cierre FAC-Cali.xlsx y diga reintenta.',
      localCopy: localPath,
    })
  );
  process.exitCode = 1;
  await mongoose.disconnect();
  process.exit(1);
}

const listed2 = await listFolder(folder, { top: 50 });
const op2 = (listed2.children || []).find((c) => c.name === OPERATIVO);
const meta2 = await getItemMetadata(op2.id);
const verify = await downloadDriveItemBuffer({
  driveId: meta2.parentReference?.driveId,
  itemId: op2.id,
});
const verifyBuf = verify.buffer || verify;
const verifyWb = new ExcelJS.Workbook();
await verifyWb.xlsx.load(verifyBuf);
const verifyWs =
  verifyWb.getWorksheet(ALFA_EXCEL_SHEET_NAME) || verifyWb.worksheets[0];
const verifyParsed = parseAlfaExcelBuffer(verifyBuf);

const source = await AlfaExcelSharePointSource.findOne({
  integrationKey: cfg.integrationKey,
});
if (source) {
  source.itemId = op2.id;
  source.fileName = toAlfaExcelOperationalFileName(OPERATIVO) || OPERATIVO;
  source.eTag = meta2.eTag;
  source.lastArnaldWrittenEtag = meta2.eTag;
  source.driveId = meta2.parentReference?.driveId;
  await source.save();
}

await AlfaExcelOutboundUpdate.updateMany(
  { status: 'pending' },
  { $set: { nextRetryAt: new Date(), attempts: 0 } }
);

console.log(
  JSON.stringify(
    {
      ok: true,
      fileName: OPERATIVO,
      finalUntouched: true,
      rows: verifyParsed.rows?.length,
      headers: lastUsedCol(verifyWs.getRow(1)),
      autoFilter: verifyWs.autoFilter,
      appended: missing.length,
      localCopy: localPath,
    },
    null,
    2
  )
);

await mongoose.disconnect();
