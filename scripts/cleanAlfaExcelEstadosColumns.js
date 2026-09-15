/**
 * Reescribe columnas ESTADO GESTION (AI) y ESTADO SINIESTRO (AJ) del Excel
 * Control y Seguimiento al catálogo oficial Alfa (sin etiquetas legacy).
 *
 *   node scripts/cleanAlfaExcelEstadosColumns.js --dry-run
 *   node scripts/cleanAlfaExcelEstadosColumns.js
 *   node scripts/cleanAlfaExcelEstadosColumns.js --from-mongo
 */
import '../config/loadEnv.js';
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
import {
  estadoGestionAlfaParaSharePoint,
  estadoAlfaParaSharePoint,
  homologarEstadoGestionAlfa,
  homologarEstadoSiniestroAlfa,
} from '../config/alfaExcelStatuses.js';

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

function resolveCol(headerRow, aliases) {
  const norms = aliases.map((h) => normalizeExcelHeader(h));
  const maxCol = Math.max(60, headerRow.cellCount || 0);
  for (let c = 1; c <= maxCol; c += 1) {
    const norm = normalizeExcelHeader(headerCellText(headerRow.getCell(c).value));
    if (norm && norms.includes(norm)) return c;
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
const gestionCol = resolveCol(headerRow, ['ESTADO GESTION', 'ESTADO DE GESTION', 'ESTADO G']);
const siniestroCol = resolveCol(headerRow, ['ESTADO SINIESTRO', 'ESTADO']);
if (!gestionCol) throw new Error('ESTADO_GESTION_HEADER_MISSING');
if (!siniestroCol) throw new Error('ESTADO_SINIESTRO_HEADER_MISSING');

const maxRow = ws.rowCount || 1;
const stats = {
  gestionChanged: 0,
  siniestroChanged: 0,
  gestionAlreadyOk: 0,
  siniestroAlreadyOk: 0,
  fromMongoGestion: 0,
  fromMongoSiniestro: 0,
  samples: [],
};

let casosByKey = null;
if (FROM_MONGO) {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URI_DIRECT;
  if (!uri) throw new Error('MONGODB_URI_MISSING');
  await mongoose.connect(uri);
  const casos = await SegurosAlfaCaso.find({})
    .select('consecutivo siniestro identificacion estado estadoGestion liquidador fechaAceptacionLiquidacion')
    .lean();
  const parsed = parseAlfaExcelBuffer(sourceBuffer);
  casosByKey = { casos, rows: parsed.rows || [] };
  log('MONGO_LOADED', { casos: casos.length, excelRows: casosByKey.rows.length });
}

for (let r = 2; r <= maxRow; r += 1) {
  const row = ws.getRow(r);
  const gCell = row.getCell(gestionCol);
  const sCell = row.getCell(siniestroCol);
  const gRaw = cellText(gCell.value).trim();
  const sRaw = cellText(sCell.value).trim();

  let nextG = gRaw ? homologarEstadoGestionAlfa(gRaw) : '';
  let nextS = sRaw ? homologarEstadoSiniestroAlfa(sRaw) : '';

  if (FROM_MONGO && casosByKey) {
    const excelRow = casosByKey.rows.find((x) => Number(x.rowNumber) === r);
    if (excelRow) {
      try {
        const match = matchAlfaCaseForExcelRow(excelRow, casosByKey.casos);
        const caso =
          match?.actionHint === 'MATCH' && Array.isArray(match.cases) && match.cases.length === 1
            ? match.cases[0]
            : null;
        if (caso) {
          const gMongo = estadoGestionAlfaParaSharePoint(caso.estadoGestion || caso.estado);
          const sMongo = estadoAlfaParaSharePoint(caso.estado);
          if (gMongo) {
            if (nextG !== gMongo) stats.fromMongoGestion += 1;
            nextG = gMongo;
          }
          if (sMongo) {
            if (nextS !== sMongo) stats.fromMongoSiniestro += 1;
            nextS = sMongo;
          }
        }
      } catch {
        /* sin match */
      }
    }
  }

  if (gRaw || nextG) {
    if (!nextG) nextG = 'EN GESTIÓN';
    if (gRaw === nextG) stats.gestionAlreadyOk += 1;
    else {
      stats.gestionChanged += 1;
      if (stats.samples.length < 25) {
        stats.samples.push({ row: r, field: 'estadoGestion', from: gRaw || null, to: nextG });
      }
      if (!DRY) gCell.value = nextG;
    }
  }

  if (sRaw || nextS) {
    if (!nextS) nextS = 'PENDIENTE';
    if (sRaw === nextS) stats.siniestroAlreadyOk += 1;
    else {
      stats.siniestroChanged += 1;
      if (stats.samples.length < 40) {
        stats.samples.push({ row: r, field: 'estado', from: sRaw || null, to: nextS });
      }
      if (!DRY) sCell.value = nextS;
    }
  }
}

log('CLEAN_PASS', {
  file: meta.name,
  gestionCol,
  siniestroCol,
  maxRow,
  dryRun: DRY,
  ...stats,
  samples: stats.samples,
});

if (FROM_MONGO && mongoose.connection.readyState === 1) {
  await mongoose.disconnect();
}

if (!NO_UPLOAD && (stats.gestionChanged > 0 || stats.siniestroChanged > 0)) {
  const out = Buffer.from(await wb.xlsx.writeBuffer());
  await replaceDriveItemContentBuffer({
    driveId,
    itemId,
    buffer: out,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  log('UPLOADED', { file: meta.name, bytes: out.length });
} else if (DRY) {
  log('DRY_RUN_NO_UPLOAD', { hint: 'Quita --dry-run para escribir en SharePoint' });
} else {
  log('NO_CHANGES_NO_UPLOAD', {});
}
