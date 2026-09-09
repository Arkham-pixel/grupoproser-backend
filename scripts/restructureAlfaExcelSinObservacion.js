/**
 * Reestructura Control y Seguimiento (BD):
 * - Elimina salida OBSERVACION.
 * - AK debe quedar como TIPO PERDIDA.
 * - Si TIPO PERDIDA estaba en AL y OBSERVACION en AK, migra AL -> AK.
 * - No mueve columnas A–AJ.
 *
 * Uso:
 *   node scripts/restructureAlfaExcelSinObservacion.js --dry-run
 *   node scripts/restructureAlfaExcelSinObservacion.js
 */
import '../config/loadEnv.js';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import {
  ALFA_EXCEL_SHEET_NAME,
} from '../config/alfaExcelOwnershipMap.js';
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

const DRY_RUN = process.argv.includes('--dry-run');
const NO_UPLOAD = DRY_RUN || process.argv.includes('--no-upload');

const OBS_ALIASES = ['OBSERVACION', 'OBSERVACIONES', 'OBSERVACIONES GESTION'];
const TIPO_ALIASES = [
  'TIPO PERDIDA',
  'TIPO DE PERDIDA',
  'TIPO DE PÉRDIDA',
  'TIPO PÉRDIDA',
  'CLASIFICACION PERDIDA',
  'CLASIFICACIÓN PÉRDIDA',
];
const TARGET_COL_AK = 37; // AK
const LEGACY_COL_AL = 38; // AL

function log(event, payload = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...payload }));
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

function headerCellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
  }
  return String(value);
}

function normalizeHeaderValue(value) {
  return normalizeExcelHeader(headerCellText(value));
}

function resolveColumnByAliases(headerRow, aliases = []) {
  const normalizedAliases = aliases.map((h) => normalizeExcelHeader(h)).filter(Boolean);
  const maxCol = Math.max(60, headerRow.cellCount || 0);
  for (let c = 1; c <= maxCol; c += 1) {
    const normalized = normalizeHeaderValue(headerRow.getCell(c).value);
    if (normalized && normalizedAliases.includes(normalized)) return c;
  }
  return null;
}

function cloneCellStyle(fromCell, toCell) {
  if (fromCell?.font) toCell.font = { ...fromCell.font };
  if (fromCell?.alignment) toCell.alignment = { ...fromCell.alignment };
  if (fromCell?.border) toCell.border = JSON.parse(JSON.stringify(fromCell.border));
  if (fromCell?.fill) {
    toCell.fill = JSON.parse(JSON.stringify(fromCell.fill));
    return;
  }
  toCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFFF00' },
  };
}

function clearColumn(ws, colNumber, fromRow = 1, toRow = null) {
  const maxRow = toRow || ws.rowCount || 1;
  let cleared = 0;
  for (let r = fromRow; r <= maxRow; r += 1) {
    const cell = ws.getRow(r).getCell(colNumber);
    if (cell.value != null && cell.value !== '') {
      cell.value = null;
      cleared += 1;
    }
  }
  return cleared;
}

function migrateTipoPerdida(ws, fromCol, toCol, fromRow = 2, toRow = null) {
  const maxRow = toRow || ws.rowCount || 1;
  let moved = 0;
  for (let r = fromRow; r <= maxRow; r += 1) {
    const row = ws.getRow(r);
    const fromCell = row.getCell(fromCol);
    const toCell = row.getCell(toCol);
    const fromVal = fromCell.value;
    if (fromVal == null || fromVal === '') continue;
    toCell.value = fromVal;
    moved += 1;
  }
  return moved;
}

function ensureHeaderTipoPerdida(headerRow, sourceStyleCol = null) {
  const targetCell = headerRow.getCell(TARGET_COL_AK);
  targetCell.value = 'TIPO PERDIDA';
  const styleSource =
    sourceStyleCol != null ? headerRow.getCell(sourceStyleCol) : headerRow.getCell(TARGET_COL_AK);
  cloneCellStyle(styleSource, targetCell);
}

function headersPreview(headerRow, from = 34, to = 40) {
  const out = [];
  for (let c = from; c <= to; c += 1) {
    out.push(`${columnNumberToLetter(c)}:${headerCellText(headerRow.getCell(c).value).trim()}`);
  }
  return out;
}

function detectPlan(headerRow) {
  const obsCol = resolveColumnByAliases(headerRow, OBS_ALIASES);
  const tipoCol = resolveColumnByAliases(headerRow, TIPO_ALIASES);
  const akHeader = normalizeHeaderValue(headerRow.getCell(TARGET_COL_AK).value);
  const alHeader = normalizeHeaderValue(headerRow.getCell(LEGACY_COL_AL).value);

  const obsAtAk = obsCol === TARGET_COL_AK;
  const tipoAtAk = tipoCol === TARGET_COL_AK || akHeader === normalizeExcelHeader('TIPO PERDIDA');
  const tipoAtAl = tipoCol === LEGACY_COL_AL || alHeader === normalizeExcelHeader('TIPO PERDIDA');

  if (tipoAtAk && !obsAtAk && !obsCol) {
    return { action: 'noop', obsCol, tipoCol, reason: 'TIPO_PERDIDA_ALREADY_AT_AK' };
  }

  if (obsAtAk && tipoAtAl) {
    return { action: 'migrate_al_to_ak', obsCol, tipoCol, reason: 'OBS_AK_TIPO_AL' };
  }

  if (obsAtAk && !tipoCol) {
    return { action: 'replace_obs_with_tipo_at_ak', obsCol, tipoCol, reason: 'OBS_ONLY_AT_AK' };
  }

  if (obsCol && tipoAtAk && obsCol !== TARGET_COL_AK) {
    return { action: 'clear_observacion_column', obsCol, tipoCol, reason: 'TIPO_AK_OBS_OTHER_COL' };
  }

  if (obsCol && tipoCol && obsCol !== tipoCol) {
    return { action: 'collapse_to_ak', obsCol, tipoCol, reason: 'BOTH_EXIST_DIFFERENT_COLS' };
  }

  if (!tipoCol && !obsCol) {
    return { action: 'set_tipo_header_ak_only', obsCol, tipoCol, reason: 'NO_OBS_NO_TIPO_HEADER' };
  }

  if (tipoCol && tipoCol !== TARGET_COL_AK) {
    return { action: 'move_tipo_to_ak', obsCol, tipoCol, reason: 'TIPO_NOT_AT_AK' };
  }

  return { action: 'noop', obsCol, tipoCol, reason: 'NO_CHANGE_REQUIRED' };
}

function applyPlan(ws, headerRow, plan) {
  const maxRow = ws.rowCount || 1;
  const stats = {
    movedTipoValues: 0,
    clearedObsCells: 0,
    clearedLegacyTipoCells: 0,
  };

  switch (plan.action) {
    case 'noop':
      return stats;

    case 'migrate_al_to_ak':
      // Primero vaciar AK (tenía OBSERVACION); luego copiar TIPO PERDIDA desde AL.
      stats.clearedObsCells = clearColumn(ws, TARGET_COL_AK, 2, maxRow);
      stats.movedTipoValues = migrateTipoPerdida(ws, LEGACY_COL_AL, TARGET_COL_AK, 2, maxRow);
      ensureHeaderTipoPerdida(headerRow, LEGACY_COL_AL);
      stats.clearedLegacyTipoCells = clearColumn(ws, LEGACY_COL_AL, 1, maxRow);
      return stats;

    case 'replace_obs_with_tipo_at_ak':
      ensureHeaderTipoPerdida(headerRow, TARGET_COL_AK);
      stats.clearedObsCells = clearColumn(ws, TARGET_COL_AK, 2, maxRow);
      return stats;

    case 'clear_observacion_column':
      if (plan.obsCol) stats.clearedObsCells = clearColumn(ws, plan.obsCol, 1, maxRow);
      ensureHeaderTipoPerdida(headerRow, TARGET_COL_AK);
      return stats;

    case 'collapse_to_ak':
      if (plan.tipoCol && plan.tipoCol !== TARGET_COL_AK) {
        stats.movedTipoValues = migrateTipoPerdida(ws, plan.tipoCol, TARGET_COL_AK, 2, maxRow);
      }
      ensureHeaderTipoPerdida(headerRow, plan.tipoCol || TARGET_COL_AK);
      if (plan.obsCol && plan.obsCol !== TARGET_COL_AK) {
        stats.clearedObsCells += clearColumn(ws, plan.obsCol, 1, maxRow);
      }
      if (plan.tipoCol && plan.tipoCol !== TARGET_COL_AK) {
        stats.clearedLegacyTipoCells += clearColumn(ws, plan.tipoCol, 1, maxRow);
      }
      return stats;

    case 'set_tipo_header_ak_only':
      ensureHeaderTipoPerdida(headerRow, TARGET_COL_AK);
      return stats;

    case 'move_tipo_to_ak':
      stats.movedTipoValues = migrateTipoPerdida(ws, plan.tipoCol, TARGET_COL_AK, 2, maxRow);
      ensureHeaderTipoPerdida(headerRow, plan.tipoCol);
      stats.clearedLegacyTipoCells = clearColumn(ws, plan.tipoCol, 1, maxRow);
      if (plan.obsCol && plan.obsCol !== TARGET_COL_AK) {
        stats.clearedObsCells = clearColumn(ws, plan.obsCol, 1, maxRow);
      }
      return stats;

    default:
      throw new Error(`PLAN_NOT_SUPPORTED:${plan.action}`);
  }
}

function verifyResult(headerRow) {
  const obsColAfter = resolveColumnByAliases(headerRow, OBS_ALIASES);
  const tipoColAfter = resolveColumnByAliases(headerRow, TIPO_ALIASES);
  const ok = tipoColAfter === TARGET_COL_AK && obsColAfter !== TARGET_COL_AK;
  return {
    ok,
    obsColAfter: obsColAfter ? columnNumberToLetter(obsColAfter) : null,
    tipoColAfter: tipoColAfter ? columnNumberToLetter(tipoColAfter) : null,
    headers: headersPreview(headerRow),
  };
}

resetMicrosoftGraphClient();
await getAccessToken();
const cfg = getAlfaExcelSharePointImportConfig();
const ctx = await resolveDriveContext();
const selection = await selectAlfaExcelFromSharePointFolder(cfg.rootPath, cfg.fileName);
if (!selection?.selected?.itemId) {
  throw new Error(selection?.outcome || 'EXCEL_SOURCE_NOT_FOUND');
}

const meta = await getItemMetadata(selection.selected.itemId);
const driveId = meta.parentReference?.driveId || ctx.driveId;
const itemId = meta.id;
const eTagBefore = meta.eTag;

const downloaded = await downloadDriveItemBuffer({ driveId, itemId });
const sourceBuffer = downloaded?.buffer || downloaded;
log('DOWNLOADED_SOURCE', {
  fileName: meta.name,
  bytes: sourceBuffer.length,
  driveId,
  itemId,
  eTagBefore,
});

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(sourceBuffer);
const ws =
  wb.getWorksheet(ALFA_EXCEL_SHEET_NAME) ||
  wb.worksheets.find((w) => String(w.name || '').trim().toUpperCase() === 'BD') ||
  wb.worksheets[0];
if (!ws) throw new Error('SHEET_BD_NOT_FOUND');

const headerRow = ws.getRow(1);
const plan = detectPlan(headerRow);
log('PLAN', {
  action: plan.action,
  reason: plan.reason,
  obsCol: plan.obsCol ? columnNumberToLetter(plan.obsCol) : null,
  tipoCol: plan.tipoCol ? columnNumberToLetter(plan.tipoCol) : null,
  headersBefore: headersPreview(headerRow),
});

let stats = { movedTipoValues: 0, clearedObsCells: 0, clearedLegacyTipoCells: 0 };
if (plan.action !== 'noop') {
  stats = applyPlan(ws, headerRow, plan);
}
headerRow.commit?.();

const verificationLocal = verifyResult(headerRow);
log('LOCAL_VERIFY', { ...verificationLocal, stats, dryRun: DRY_RUN });

const outDir = path.join(process.cwd(), 'tmp');
fs.mkdirSync(outDir, { recursive: true });
const localPath = path.join(outDir, `alfa-restructure-sin-observacion-${Date.now()}.xlsx`);
await wb.xlsx.writeFile(localPath);
log('SAVED_LOCAL_COPY', { path: localPath });

if (NO_UPLOAD || plan.action === 'noop') {
  log('DONE_NO_UPLOAD', {
    dryRun: DRY_RUN,
    noUpload: NO_UPLOAD,
    noop: plan.action === 'noop',
  });
  process.exit(0);
}

const uploadBuffer = fs.readFileSync(localPath);
const uploaded = await replaceDriveItemContentBuffer({
  driveId,
  itemId,
  buffer: uploadBuffer,
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ifMatch: eTagBefore || undefined,
});
log('UPLOADED', {
  fileName: meta.name,
  eTagBefore,
  eTagAfter: uploaded?.eTag || null,
});

const verifyDownloaded = await downloadDriveItemBuffer({ driveId, itemId });
const verifyWb = new ExcelJS.Workbook();
await verifyWb.xlsx.load(verifyDownloaded?.buffer || verifyDownloaded);
const verifyWs =
  verifyWb.getWorksheet(ALFA_EXCEL_SHEET_NAME) ||
  verifyWb.worksheets.find((w) => String(w.name || '').trim().toUpperCase() === 'BD') ||
  verifyWb.worksheets[0];
if (!verifyWs) throw new Error('VERIFY_SHEET_BD_NOT_FOUND');
const verificationRemote = verifyResult(verifyWs.getRow(1));
log('REMOTE_VERIFY', verificationRemote);
if (!verificationRemote.ok) {
  throw new Error(
    `VERIFY_FAILED: tipoCol=${verificationRemote.tipoColAfter || 'null'} obsCol=${verificationRemote.obsColAfter || 'null'}`
  );
}
log('DONE', {
  action: plan.action,
  stats,
  tipoPerdidaColumn: verificationRemote.tipoColAfter,
});
