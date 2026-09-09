/**
 * Asegura la columna amarilla ARNALD «TIPO PERDIDA» en el consolidado FAC-Cali.
 *
 * Estrategia segura (sin alterar A–AK):
 * - Si el encabezado ya existe → no hace nada.
 * - Si falta → escribe el título en la siguiente columna libre DESPUÉS de OBSERVACION
 *   (o después del último encabezado usado). NO inserta/corre columnas existentes.
 * - Copia el relleno amarillo del encabezado OBSERVACION (o FFEB9C).
 * - Extiende AutoFilter si aplica.
 *
 * Uso:
 *   node scripts/ensureAlfaExcelTipoPerdidaColumn.js --dry-run
 *   node scripts/ensureAlfaExcelTipoPerdidaColumn.js
 *   node scripts/ensureAlfaExcelTipoPerdidaColumn.js --from-local=./tmp.xlsx --no-upload
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import {
  ALFA_EXCEL_SHEET_NAME,
  getOwnershipEntry,
} from '../config/alfaExcelOwnershipMap.js';
import { normalizeExcelHeader } from '../utils/alfaExcelNormalize.js';
import {
  downloadDriveItemBuffer,
  getAccessToken,
  getItemMetadata,
  replaceDriveItemContentBuffer,
  resetMicrosoftGraphClient,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import { selectAlfaExcelFromSharePointFolder } from '../services/alfaExcelSharePointImportService.js';

const DRY = process.argv.includes('--dry-run');
const NO_UPLOAD = process.argv.includes('--no-upload') || DRY;
const fromLocalArg = process.argv.find((a) => a.startsWith('--from-local='));
const fromLocal = fromLocalArg ? fromLocalArg.slice('--from-local='.length) : '';

const TARGET = getOwnershipEntry('tipoPerdida');
const ANCHOR = getOwnershipEntry('observacionesGestion');

function headerCellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
  }
  return String(value);
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
  const maxCol = Math.max(50, headerRow.cellCount || 0);
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

function cloneHeaderStyle(fromCell, toCell) {
  if (fromCell?.font) toCell.font = { ...fromCell.font };
  if (fromCell?.alignment) toCell.alignment = { ...fromCell.alignment };
  if (fromCell?.border) toCell.border = JSON.parse(JSON.stringify(fromCell.border));
  if (fromCell?.fill) {
    toCell.fill = JSON.parse(JSON.stringify(fromCell.fill));
  } else {
    toCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFF00' },
    };
  }
}

function dumpHeaders(headerRow, upTo) {
  const out = [];
  for (let c = 1; c <= upTo; c += 1) {
    const text = headerCellText(headerRow.getCell(c).value).trim();
    if (!text) continue;
    out.push(`${columnNumberToLetter(c)}:${text}`);
  }
  return out;
}

let driveId = null;
let itemId = null;
let eTagBefore = null;
let sourceName = null;
let sourceBuffer = null;

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

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(sourceBuffer);
const ws =
  wb.getWorksheet(ALFA_EXCEL_SHEET_NAME) ||
  wb.worksheets.find((w) => String(w.name).trim().toUpperCase() === 'BD') ||
  wb.worksheets[0];
if (!ws) throw new Error('NO_SHEET_BD');

const headerRow = ws.getRow(1);
const existing = resolveCol(headerRow, TARGET);
const observacionCol = resolveCol(headerRow, ANCHOR);
const lastCol = lastUsedCol(headerRow);

console.log(
  JSON.stringify({
    event: 'HEADERS_BEFORE',
    sheet: ws.name,
    lastCol: columnNumberToLetter(lastCol),
    observacionCol: observacionCol ? columnNumberToLetter(observacionCol) : null,
    tipoPerdidaCol: existing ? columnNumberToLetter(existing) : null,
    headers: dumpHeaders(headerRow, Math.max(lastCol, 40)),
  })
);

if (existing) {
  console.log(
    JSON.stringify({
      event: 'ALREADY_PRESENT',
      column: columnNumberToLetter(existing),
      header: headerCellText(headerRow.getCell(existing).value),
    })
  );
  process.exit(0);
}

if (!observacionCol) {
  throw new Error('ANCHOR_OBSERVACION_MISSING: no se encontró OBSERVACION para anclar TIPO PERDIDA');
}

// Siguiente columna libre después de OBSERVACION (sin insertar/correr A–AK).
let targetCol = observacionCol + 1;
while (targetCol <= lastCol + 5) {
  const text = headerCellText(headerRow.getCell(targetCol).value).trim();
  if (!text) break;
  targetCol += 1;
}

const styleSource = headerRow.getCell(observacionCol);
const cell = headerRow.getCell(targetCol);
cell.value = TARGET.header;
cloneHeaderStyle(styleSource, cell);
headerRow.height = headerRow.height || 30;

// Extender AutoFilter si existe y no cubre la nueva columna
try {
  const af = ws.autoFilter;
  if (af) {
    const ref = typeof af === 'string' ? af : af.from && af.to ? null : String(af);
    // ExcelJS: ws.autoFilter may be object with from/to or a range string
    let start = 'A1';
    let endCol = targetCol;
    if (typeof af === 'string' && af.includes(':')) {
      const [a, b] = af.split(':');
      start = a.replace(/\d+$/, '1');
      const endLetter = b.replace(/\d+$/, '');
      // keep end row from previous if present
      const endRow = (b.match(/\d+$/) || ['1'])[0];
      ws.autoFilter = `${start}:${columnNumberToLetter(endCol)}${endRow}`;
    } else if (af?.from && af?.to) {
      ws.autoFilter = {
        from: { row: 1, column: af.from.column || 1 },
        to: { row: 1, column: Math.max(af.to.column || 1, endCol) },
      };
    } else if (ref) {
      ws.autoFilter = `A1:${columnNumberToLetter(endCol)}1`;
    }
  }
} catch (e) {
  console.log(JSON.stringify({ event: 'AUTOFILTER_SKIP', reason: String(e?.message || e) }));
}

headerRow.commit?.();

console.log(
  JSON.stringify({
    event: 'COLUMN_ADDED',
    column: columnNumberToLetter(targetCol),
    header: TARGET.header,
    after: columnNumberToLetter(observacionCol),
    dryRun: DRY,
    willUpload: !NO_UPLOAD,
  })
);

const outDir = path.join(process.cwd(), 'tmp');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `alfa-tipo-perdida-${Date.now()}.xlsx`);
await wb.xlsx.writeFile(outPath);
console.log(JSON.stringify({ event: 'SAVED_LOCAL_COPY', path: outPath }));

if (NO_UPLOAD) {
  console.log(JSON.stringify({ event: 'DONE_NO_UPLOAD' }));
  process.exit(0);
}

const buffer = fs.readFileSync(outPath);
const uploaded = await replaceDriveItemContentBuffer({
  driveId,
  itemId,
  buffer,
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

console.log(
  JSON.stringify({
    event: 'UPLOADED_SHAREPOINT',
    file: sourceName,
    itemId: uploaded?.id || itemId,
    eTagBefore,
    eTagAfter: uploaded?.eTag || null,
  })
);

// Verificación
const verifyDl = await downloadDriveItemBuffer({ driveId, itemId });
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.load(verifyDl.buffer);
const ws2 =
  wb2.getWorksheet(ALFA_EXCEL_SHEET_NAME) ||
  wb2.worksheets.find((w) => String(w.name).trim().toUpperCase() === 'BD') ||
  wb2.worksheets[0];
const hr2 = ws2.getRow(1);
const verified = resolveCol(hr2, TARGET);
console.log(
  JSON.stringify({
    event: 'VERIFIED',
    ok: Boolean(verified),
    column: verified ? columnNumberToLetter(verified) : null,
    header: verified ? headerCellText(hr2.getCell(verified).value) : null,
  })
);

if (!verified) process.exit(2);
console.log(JSON.stringify({ event: 'DONE' }));
