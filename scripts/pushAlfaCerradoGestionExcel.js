/**
 * Alinea ESTADO GESTION (AI) con reglas siniestro→gestión vía Graph workbook.
 * - OBJETADO / DESISTIDO → CERRADO
 * - PENDIENTE ACEPTACION CIFRAS → LIQUIDADO
 *
 *   node scripts/pushAlfaCerradoGestionExcel.js
 *   node scripts/pushAlfaCerradoGestionExcel.js --dry-run
 */
import '../config/loadEnv.js';
import ExcelJS from 'exceljs';
import { ALFA_EXCEL_SHEET_NAME } from '../config/alfaExcelOwnershipMap.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import { selectAlfaExcelFromSharePointFolder } from '../services/alfaExcelSharePointImportService.js';
import {
  sincronizarGestionConCierreSiniestroAlfa,
  homologarEstadoGestionAlfa,
  homologarEstadoSiniestroAlfa,
} from '../config/alfaExcelStatuses.js';
import {
  resetMicrosoftGraphClient,
  getAccessToken,
  resolveDriveContext,
  getItemMetadata,
  downloadDriveItemBuffer,
  createWorkbookSession,
  closeWorkbookSession,
  updateWorkbookRange,
} from '../services/microsoftGraphService.js';
import { normalizeExcelHeader } from '../utils/alfaExcelNormalize.js';

const DRY = process.argv.includes('--dry-run');

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

function resolveCol(headerRow, aliases) {
  const norms = aliases.map((h) => normalizeExcelHeader(h));
  const maxCol = Math.max(60, headerRow.cellCount || 0);
  for (let c = 1; c <= maxCol; c += 1) {
    const norm = normalizeExcelHeader(headerCellText(headerRow.getCell(c).value));
    if (norm && norms.includes(norm)) return c;
  }
  return null;
}

function colLetter(n) {
  let x = Number(n);
  let s = '';
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
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

const sheetName = ws.name;
const headerRow = ws.getRow(1);
const gestionCol = resolveCol(headerRow, ['ESTADO GESTION', 'ESTADO DE GESTION', 'ESTADO G']);
const siniestroCol = resolveCol(headerRow, ['ESTADO SINIESTRO', 'ESTADO']);
if (!gestionCol || !siniestroCol) throw new Error('HEADERS_MISSING');

const gLetter = colLetter(gestionCol);
const updates = [];
const maxRow = ws.rowCount || 1;

for (let r = 2; r <= maxRow; r += 1) {
  const row = ws.getRow(r);
  const gRaw = cellText(row.getCell(gestionCol).value).trim();
  const sRaw = cellText(row.getCell(siniestroCol).value).trim();
  if (!sRaw && !gRaw) continue;
  const nextS = sRaw ? homologarEstadoSiniestroAlfa(sRaw) : '';
  if (
    nextS !== 'OBJETADO' &&
    nextS !== 'DESISTIDO' &&
    nextS !== 'PENDIENTE ACEPTACION CIFRAS'
  ) {
    continue;
  }
  const nextG = sincronizarGestionConCierreSiniestroAlfa(nextS, gRaw);
  const actual = gRaw ? homologarEstadoGestionAlfa(gRaw) : '';
  if (actual === nextG) continue;
  updates.push({
    row: r,
    address: `${gLetter}${r}`,
    from: gRaw || null,
    to: nextG,
    siniestro: nextS,
  });
}

log('PLAN', {
  sheetName,
  gestionCol: gLetter,
  pending: updates.length,
  dryRun: DRY,
  samples: updates.slice(0, 15),
});

if (!updates.length) {
  log('NO_CHANGES', {});
  process.exit(0);
}

if (DRY) {
  log('DRY_RUN', { hint: 'Quita --dry-run para escribir vía Graph workbook' });
  process.exit(0);
}

let sessionId = null;
let ok = 0;
let fail = 0;
try {
  const session = await createWorkbookSession({ driveId, itemId, persistChanges: true });
  sessionId = session?.id;
  if (!sessionId) throw new Error('NO_WORKBOOK_SESSION');
  log('SESSION_OK', { sessionId: String(sessionId).slice(0, 12) });

  for (const u of updates) {
    try {
      await updateWorkbookRange({
        driveId,
        itemId,
        worksheetName: sheetName,
        address: u.address,
        values: [[u.to]],
        sessionId,
      });
      ok += 1;
    } catch (err) {
      fail += 1;
      log('CELL_FAIL', { address: u.address, error: err.message || String(err) });
    }
  }
} finally {
  if (sessionId) {
    await closeWorkbookSession({ driveId, itemId, sessionId });
  }
}

log('DONE', { ok, fail, pending: updates.length });
if (fail) process.exit(1);
