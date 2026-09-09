/**
 * Limpia AK (TIPO PERDIDA): borra textos viejos de OBSERVACION.
 * Solo deja PARCIAL / TOTAL; opcionalmente rellena desde Mongo ARNALD.
 *
 *   node scripts/cleanAlfaExcelTipoPerdidaColumn.js --dry-run
 *   node scripts/cleanAlfaExcelTipoPerdidaColumn.js
 *   node scripts/cleanAlfaExcelTipoPerdidaColumn.js --from-mongo
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { ALFA_EXCEL_SHEET_NAME } from '../config/alfaExcelOwnershipMap.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import { selectAlfaExcelFromSharePointFolder } from '../services/alfaExcelSharePointImportService.js';
import {
  resetMicrosoftGraphClient,
  getAccessToken,
  resolveDriveContext,
  getItemMetadata,
  downloadDriveItemBuffer,
  replaceDriveItemContentBuffer,
} from '../services/microsoftGraphService.js';
import { normalizeExcelHeader } from '../utils/alfaExcelNormalize.js';
import {
  parseAlfaExcelBuffer,
  matchAlfaCaseForExcelRow,
} from '../services/alfaExcelImportService.js';

const DRY = process.argv.includes('--dry-run');
const FROM_MONGO = process.argv.includes('--from-mongo');
const NO_UPLOAD = DRY || process.argv.includes('--no-upload');

function log(event, payload = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...payload }));
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

function cellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
  }
  return String(value);
}

function homologarTipo(value) {
  const n = String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .trim();
  if (n === 'PARCIAL' || n === 'P') return 'PARCIAL';
  if (n === 'TOTAL' || n === 'T') return 'TOTAL';
  if (n.includes('PARCIAL') && n.length < 40) return 'PARCIAL';
  if (n.includes('TOTAL') && n.length < 40 && !n.includes('TOTALMENTE')) return 'TOTAL';
  return '';
}

function resolveTipoCol(headerRow) {
  const aliases = [
    'TIPO PERDIDA',
    'TIPO DE PERDIDA',
    'TIPO DE PÉRDIDA',
    'TIPO PÉRDIDA',
  ].map((h) => normalizeExcelHeader(h));
  const maxCol = Math.max(50, headerRow.cellCount || 0);
  for (let c = 1; c <= maxCol; c += 1) {
    const norm = normalizeExcelHeader(headerCellText(headerRow.getCell(c).value));
    if (norm && aliases.includes(norm)) return c;
  }
  return null;
}

resetMicrosoftGraphClient();
await getAccessToken();
const cfg = getAlfaExcelSharePointImportConfig();
const ctx = await resolveDriveContext();
const sel = await selectAlfaExcelFromSharePointFolder(cfg.rootPath, cfg.fileName);
const meta = await getItemMetadata(sel.selected.itemId);
const driveId = meta.parentReference?.driveId || ctx.driveId;
const itemId = meta.id;

const dl = await downloadDriveItemBuffer({ driveId, itemId });
const sourceBuffer = dl.buffer || dl;
log('DOWNLOADED', { file: meta.name, bytes: sourceBuffer.length, eTag: meta.eTag });

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(sourceBuffer);
const ws =
  wb.getWorksheet(ALFA_EXCEL_SHEET_NAME) ||
  wb.worksheets.find((w) => String(w.name).trim().toUpperCase() === 'BD') ||
  wb.worksheets[0];
if (!ws) throw new Error('NO_SHEET_BD');

const headerRow = ws.getRow(1);
const tipoCol = resolveTipoCol(headerRow);
if (!tipoCol) throw new Error('TIPO_PERDIDA_HEADER_MISSING');

const maxRow = ws.rowCount || 1;
let clearedObsLike = 0;
let keptValid = 0;
let emptied = 0;

for (let r = 2; r <= maxRow; r += 1) {
  const cell = ws.getRow(r).getCell(tipoCol);
  const raw = cellText(cell.value).trim();
  if (!raw) {
    emptied += 1;
    continue;
  }
  const tip = homologarTipo(raw);
  if (tip) {
    if (raw !== tip) cell.value = tip;
    keptValid += 1;
  } else {
    // Texto de observación u otro: no pertenece a TIPO PERDIDA
    cell.value = null;
    clearedObsLike += 1;
  }
}

log('CLEAN_PASS', {
  tipoCol,
  maxRow,
  clearedObsLike,
  keptValid,
  emptyRows: emptied,
});

let filledFromMongo = 0;
if (FROM_MONGO) {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI_MISSING');
  await mongoose.connect(uri);
  const casos = await SegurosAlfaCaso.find({})
    .select('consecutivo siniestro identificacion tipoPerdida')
    .lean();
  const parsed = parseAlfaExcelBuffer(sourceBuffer);
  for (const excelRow of parsed.rows || []) {
    const match = matchAlfaCaseForExcelRow(excelRow, casos);
    const caso = match?.caso;
    if (!caso) continue;
    const tip = homologarTipo(caso.tipoPerdida);
    if (!tip) continue;
    const excelRowNum = excelRow.rowNumber;
    if (!excelRowNum || excelRowNum < 2) continue;
    const cell = ws.getRow(excelRowNum).getCell(tipoCol);
    const current = homologarTipo(cellText(cell.value));
    if (current) continue;
    cell.value = tip;
    filledFromMongo += 1;
  }
  await mongoose.disconnect();
  log('MONGO_FILL', { filledFromMongo });
}

// Asegurar encabezado limpio
headerRow.getCell(tipoCol).value = 'TIPO PERDIDA';

const outDir = path.join(process.cwd(), 'tmp');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `alfa-clean-tipo-perdida-${Date.now()}.xlsx`);
await wb.xlsx.writeFile(outPath);
log('SAVED_LOCAL', { path: outPath, dryRun: DRY });

if (NO_UPLOAD) {
  log('DONE_NO_UPLOAD');
  process.exit(0);
}

const buffer = fs.readFileSync(outPath);
const uploaded = await replaceDriveItemContentBuffer({
  driveId,
  itemId,
  buffer,
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});
log('UPLOADED', { eTagAfter: uploaded?.eTag || null });

const verifyDl = await downloadDriveItemBuffer({ driveId, itemId });
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.load(verifyDl.buffer || verifyDl);
const ws2 =
  wb2.getWorksheet(ALFA_EXCEL_SHEET_NAME) ||
  wb2.worksheets.find((w) => String(w.name).trim().toUpperCase() === 'BD') ||
  wb2.worksheets[0];
const hr2 = ws2.getRow(1);
const col2 = resolveTipoCol(hr2);
let sampleBad = 0;
let sampleOk = 0;
for (let r = 2; r <= Math.min(ws2.rowCount || 1, 2500); r += 1) {
  const v = cellText(ws2.getRow(r).getCell(col2).value).trim();
  if (!v) continue;
  if (homologarTipo(v)) sampleOk += 1;
  else sampleBad += 1;
}
log('VERIFIED', { tipoCol: col2, sampleOk, sampleBad, header: headerCellText(hr2.getCell(col2).value) });
if (sampleBad > 0) process.exit(2);
log('DONE');
