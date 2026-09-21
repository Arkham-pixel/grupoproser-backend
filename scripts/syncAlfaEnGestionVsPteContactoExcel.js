/**
 * Alinea ESTADO GESTION entre Excel (AI) y Mongo ARNALD:
 * - PTE CONTACTO solo donde Excel (o Mongo tipificado) lo tiene de verdad
 * - EN GESTIÓN no se mezcla con PTE CONTACTO
 * - Reescribe la columna AI del consolidado SharePoint
 *
 *   node scripts/syncAlfaEnGestionVsPteContactoExcel.js --dry-run
 *   node scripts/syncAlfaEnGestionVsPteContactoExcel.js --apply
 *   node scripts/syncAlfaEnGestionVsPteContactoExcel.js --apply --mongo-only
 *   node scripts/syncAlfaEnGestionVsPteContactoExcel.js --apply --excel-only
 */
import '../config/loadEnv.js';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { ALFA_EXCEL_SHEET_NAME } from '../config/alfaExcelOwnershipMap.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import { selectAlfaExcelFromSharePointFolder } from '../services/alfaExcelSharePointImportService.js';
import {
  parseAlfaExcelBuffer,
  matchAlfaCaseForExcelRow,
} from '../services/alfaExcelImportService.js';
import {
  homologarEstadoGestionAlfa,
  homologarEstadoSiniestroAlfa,
  sincronizarGestionConCierreSiniestroAlfa,
  estadoGestionAlfaParaSharePoint,
  estadoAlfaParaSharePoint,
} from '../config/alfaExcelStatuses.js';
import {
  resetMicrosoftGraphClient,
  getAccessToken,
  resolveDriveContext,
  getItemMetadata,
  downloadDriveItemBuffer,
  replaceDriveItemContentBuffer,
} from '../services/microsoftGraphService.js';
import { normalizeExcelHeader } from '../utils/alfaExcelNormalize.js';

const DRY = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
const MONGO_ONLY = process.argv.includes('--mongo-only');
const EXCEL_ONLY = process.argv.includes('--excel-only');
const DO_MONGO = !EXCEL_ONLY;
const DO_EXCEL = !MONGO_ONLY;

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

function gestionCanonDesdeExcel(raw) {
  const g = homologarEstadoGestionAlfa(raw);
  // Si Excel trae vacío / basura → EN GESTIÓN (no PTE CONTACTO).
  if (!String(raw || '').trim()) return 'EN GESTIÓN';
  return g || 'EN GESTIÓN';
}

function gestionFinalParaCaso({ excelGestionRaw, mongoGestion, mongoEstado }) {
  const excelG = String(excelGestionRaw || '').trim()
    ? gestionCanonDesdeExcel(excelGestionRaw)
    : null;
  // Excel tipifica PTE CONTACTO de forma explícita → respetar.
  if (excelG === 'PTE CONTACTO') return 'PTE CONTACTO';

  let g = homologarEstadoGestionAlfa(mongoGestion || excelGestionRaw || '');
  // PTE CONTACTO en Mongo sin respaldo en Excel → era homologación vieja.
  if (g === 'PTE CONTACTO' && excelG && excelG !== 'PTE CONTACTO') {
    g = excelG;
  } else if (g === 'PTE CONTACTO' && !excelG) {
    // Sin fila Excel confiable: no inventar PTE CONTACTO.
    g = 'EN GESTIÓN';
  } else if (excelG) {
    g = excelG;
  }

  const s = homologarEstadoSiniestroAlfa(mongoEstado);
  return sincronizarGestionConCierreSiniestroAlfa(s, g) || g || 'EN GESTIÓN';
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
log('DOWNLOADED', { file: meta.name, bytes: sourceBuffer.length, dryRun: DRY });

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URI_DIRECT;
if (!uri) throw new Error('MONGODB_URI_MISSING');
await mongoose.connect(uri);

const casos = await SegurosAlfaCaso.find({})
  .select(
    'consecutivo siniestro identificacion estado estadoGestion liquidador fechaAceptacionLiquidacion'
  )
  .lean();
const parsed = parseAlfaExcelBuffer(sourceBuffer);
const excelRows = parsed.rows || [];

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

const stats = {
  matched: 0,
  mongoUpdated: 0,
  excelUpdated: 0,
  excelAlreadyOk: 0,
  mongoAlreadyOk: 0,
  unmatchedExcel: 0,
  countsGestion: {},
  samples: [],
};

const mongoPatchById = new Map();

for (const excelRow of excelRows) {
  const r = Number(excelRow.rowNumber);
  if (!r || r < 2) continue;
  const sheetRow = ws.getRow(r);
  const gRaw = cellText(sheetRow.getCell(gestionCol).value).trim();
  const sRaw = siniestroCol ? cellText(sheetRow.getCell(siniestroCol).value).trim() : '';
  const payload = excelRow.payload || excelRow;

  let caso = null;
  try {
    const match = matchAlfaCaseForExcelRow(payload, casos);
    if (match?.actionHint === 'MATCH' && Array.isArray(match.cases) && match.cases.length === 1) {
      caso = match.cases[0];
    }
  } catch {
    /* sin match */
  }

  if (!caso) {
    stats.unmatchedExcel += 1;
    // Igual normaliza Excel sin Mongo.
    const nextG = gestionCanonDesdeExcel(gRaw);
    const nextS = sRaw ? estadoAlfaParaSharePoint(sRaw) : '';
    if (DO_EXCEL && gRaw !== nextG) {
      stats.excelUpdated += 1;
      if (stats.samples.length < 30) {
        stats.samples.push({ row: r, field: 'excel', from: gRaw || null, to: nextG, mongo: null });
      }
      if (!DRY) sheetRow.getCell(gestionCol).value = nextG;
    } else if (DO_EXCEL) {
      stats.excelAlreadyOk += 1;
    }
    stats.countsGestion[nextG] = (stats.countsGestion[nextG] || 0) + 1;
    continue;
  }

  stats.matched += 1;
  const nextG = gestionFinalParaCaso({
    excelGestionRaw: gRaw,
    mongoGestion: caso.estadoGestion,
    mongoEstado: caso.estado || sRaw,
  });
  const nextS = estadoAlfaParaSharePoint(caso.estado || sRaw);
  stats.countsGestion[nextG] = (stats.countsGestion[nextG] || 0) + 1;

  const mongoActual = homologarEstadoGestionAlfa(caso.estadoGestion || '');
  if (DO_MONGO && mongoActual !== nextG) {
    stats.mongoUpdated += 1;
    mongoPatchById.set(String(caso._id), nextG);
    if (stats.samples.length < 30) {
      stats.samples.push({
        row: r,
        consecutivo: caso.consecutivo,
        field: 'mongo',
        from: caso.estadoGestion || null,
        to: nextG,
      });
    }
  } else if (DO_MONGO) {
    stats.mongoAlreadyOk += 1;
  }

  if (DO_EXCEL) {
    const excelTarget = estadoGestionAlfaParaSharePoint(nextG);
    if (gRaw !== excelTarget) {
      stats.excelUpdated += 1;
      if (stats.samples.length < 40) {
        stats.samples.push({
          row: r,
          consecutivo: caso.consecutivo,
          field: 'excel',
          from: gRaw || null,
          to: excelTarget,
        });
      }
      if (!DRY) sheetRow.getCell(gestionCol).value = excelTarget;
    } else {
      stats.excelAlreadyOk += 1;
    }
    if (siniestroCol && sRaw && nextS && sRaw !== nextS && !DRY) {
      // No forzar siniestro salvo homologación trivial; solo gestión es el foco.
    }
  }
}

// Casos Mongo PTE CONTACTO sin fila Excel emparejada → EN GESTIÓN
if (DO_MONGO) {
  const matchedIds = new Set(
    [...mongoPatchById.keys()].concat(
      excelRows
        .map((er) => {
          try {
            const m = matchAlfaCaseForExcelRow(er.payload || er, casos);
            if (m?.actionHint === 'MATCH' && m.cases?.length === 1) return String(m.cases[0]._id);
          } catch {
            return null;
          }
          return null;
        })
        .filter(Boolean)
    )
  );

  for (const caso of casos) {
    const id = String(caso._id);
    if (matchedIds.has(id)) continue;
    const g = homologarEstadoGestionAlfa(caso.estadoGestion || '');
    if (g !== 'PTE CONTACTO') continue;
    const nextG = sincronizarGestionConCierreSiniestroAlfa(caso.estado, 'EN GESTIÓN');
    if (g === nextG) continue;
    stats.mongoUpdated += 1;
    mongoPatchById.set(id, nextG);
    if (stats.samples.length < 50) {
      stats.samples.push({
        consecutivo: caso.consecutivo,
        field: 'mongo-orphan-pte',
        from: caso.estadoGestion,
        to: nextG,
      });
    }
  }
}

if (!DRY && DO_MONGO && mongoPatchById.size) {
  for (const [id, nextG] of mongoPatchById.entries()) {
    await SegurosAlfaCaso.updateOne({ _id: id }, { $set: { estadoGestion: nextG } });
  }
}

if (!DRY && DO_EXCEL && stats.excelUpdated > 0) {
  const out = Buffer.from(await wb.xlsx.writeBuffer());
  await replaceDriveItemContentBuffer({
    driveId,
    itemId,
    buffer: out,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  log('UPLOADED', { file: meta.name, bytes: out.length });
}

log('SYNC_DONE', {
  dryRun: DRY,
  doMongo: DO_MONGO,
  doExcel: DO_EXCEL,
  file: meta.name,
  ...stats,
  mongoPatches: mongoPatchById.size,
  hint: DRY
    ? 'Ejecuta con --apply para escribir Mongo + Excel SharePoint'
    : 'Mongo/Excel actualizados',
});

await mongoose.disconnect();
process.exit(0);
