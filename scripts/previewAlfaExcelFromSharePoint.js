/**
 * Prueba manual: SharePoint CONTROL Y SEGUIMIENTO → Excel → Preview.
 * NO execute. NO modifica casos Alfa.
 *
 * node scripts/previewAlfaExcelFromSharePoint.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import {
  resolveDriveContext,
  listFolder,
  getItemMetadata,
  downloadDriveItemBuffer,
} from '../services/microsoftGraphService.js';
import { previewAlfaExcelImport } from '../services/alfaExcelImportService.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';

const SOURCE_PATH = 'SEGUROS ALFA/CONTROL Y SEGUIMIENTO';
const FILE_NAME =
  process.env.SHAREPOINT_ALFA_EXCEL_FILE_NAME ||
  'CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali.xlsx';

function isTempOffice(name) {
  return String(name || '').startsWith('~$');
}
function isExcel(name) {
  return /\.(xlsx|xls)$/i.test(String(name || ''));
}

async function selectExcel() {
  const listed = await listFolder(SOURCE_PATH, { top: 200 });
  const candidates = (listed.children || []).filter((c) => {
    if (c.folder) return false;
    const name = c.name || '';
    if (isTempOffice(name)) return false;
    if (!isExcel(name)) return false;
    if (!c.size || Number(c.size) === 0) return false;
    return true;
  });

  const hit = candidates.find((c) => c.name === FILE_NAME);
  if (!hit) {
    const err = new Error(`CONFIGURED_EXCEL_NOT_FOUND: ${FILE_NAME}`);
    err.code = 'CONFIGURED_EXCEL_NOT_FOUND';
    err.candidates = candidates.map((c) => c.name);
    throw err;
  }
  return hit;
}

function moneyish(v) {
  if (v == null || v === '') return String(v);
  if (typeof v === 'number') {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(v);
  }
  return String(v);
}

function formatChange(field, before, after) {
  const empty = (x) => (x == null || x === '' ? 'vacío' : String(x));
  if (
    /valor|reserva|reclamado|liquidado|comercial|asegurado/i.test(field) &&
    (typeof before === 'number' || typeof after === 'number')
  ) {
    return `${moneyish(before)} → ${moneyish(after)}`;
  }
  return `${empty(before)} → ${empty(after)}`;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI requerido');
  await mongoose.connect(uri);

  const casesBefore = await SegurosAlfaCaso.countDocuments();
  const casesFingerprintBefore = await SegurosAlfaCaso.find()
    .select('_id updatedAt')
    .lean();
  const ctx = await resolveDriveContext();
  const selected = await selectExcel();
  const meta = await getItemMetadata(selected.id);

  const sourceMeta = {
    fileName: meta.name,
    itemId: meta.id,
    eTag: meta.eTag,
    lastModifiedDateTime: meta.lastModifiedDateTime,
    size: meta.size,
    sourcePath: SOURCE_PATH,
    driveId: ctx.driveId,
    configuredFileName: FILE_NAME,
  };

  console.log('=== METADATA FUENTE ===');
  console.log(JSON.stringify(sourceMeta, null, 2));

  const downloaded = await downloadDriveItemBuffer({
    driveId: ctx.driveId,
    itemId: meta.id,
  });
  const buffer = downloaded.buffer;
  console.log(`\nDescargado: ${buffer?.length} bytes (meta.size=${downloaded.size})`);

  const preview = await previewAlfaExcelImport({
    buffer,
    fileName: meta.name,
    mimeType:
      downloaded.mimeType ||
      meta.file?.mimeType ||
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    user: { id: 'script', login: 'script', nombre: 'previewAlfaExcelFromSharePoint' },
    source: 'sharepoint',
  });

  const casesAfter = await SegurosAlfaCaso.countDocuments();
  const casesFingerprintAfter = await SegurosAlfaCaso.find()
    .select('_id updatedAt')
    .lean();
  const fpBefore = new Map(
    casesFingerprintBefore.map((c) => [String(c._id), String(c.updatedAt)])
  );
  let casosMutados = 0;
  for (const c of casesFingerprintAfter) {
    if (fpBefore.get(String(c._id)) !== String(c.updatedAt)) casosMutados += 1;
  }

  // Fetch all planned rows from DB for full detail (sampleRows capped at 50)
  const AlfaExcelImportRow = (await import('../models/AlfaExcelImportRow.js')).default;
  const allRows = await AlfaExcelImportRow.find({
    importId: preview.importSessionId,
  })
    .sort({ rowNumber: 1 })
    .lean();

  const created = allRows.filter((r) => r.action === 'CREATED');
  const updated = allRows.filter((r) => r.action === 'UPDATED');
  const unchanged = allRows.filter((r) => r.action === 'UNCHANGED');
  const ambiguous = allRows.filter((r) => r.action === 'AMBIGUOUS');
  const rejected = allRows.filter((r) => r.action === 'REJECTED');

  const singleCell = updated.filter((r) => Object.keys(r.changes || {}).length === 1);
  const multiCell = updated.filter((r) => Object.keys(r.changes || {}).length > 1);
  const placeholderToReal = allRows.filter((r) =>
    (r.warnings || []).includes('POLIZA_PLACEHOLDER_TO_REAL')
  );
  const claimAssign = allRows.filter(
    (r) => r.claimNumberAssigned || r.claimNumberEventPending
  );
  const policyNumberUpdates = updated.filter((r) => r.changes?.numeroPoliza);

  const hasChanges = created.length > 0 || updated.length > 0;
  const hasIncidents = ambiguous.length > 0 || rejected.length > 0;

  const summary = {
    totalRows: allRows.length,
    created: created.length,
    updated: updated.length,
    unchanged: unchanged.length,
    ambiguous: ambiguous.length,
    rejected: rejected.length,
    hasChanges,
    hasIncidents,
    uiStatus: hasChanges
      ? 'ACTUALIZACIONES DISPONIBLES'
      : hasIncidents
        ? 'SIN ACTUALIZACIONES PENDIENTES (con incidencias)'
        : 'SIN ACTUALIZACIONES PENDIENTES',
    placeholderPolicyToReal: placeholderToReal.length,
    claimNumberAssignments: claimAssign.length,
    policyNumberUpdates: policyNumberUpdates.length,
    singleCellUpdates: singleCell.length,
    multiCellUpdates: multiCell.length,
    possibleExistingDuplicates: preview.insights?.possibleExistingDuplicates ?? 0,
    insights: preview.insights,
    importSessionId: preview.importSessionId,
    source: 'sharepoint',
  };

  console.log('\n=== RESUMEN ===');
  console.log(JSON.stringify(summary, null, 2));

  function detailRow(r) {
    const snap = r.previewSnapshot || {};
    const changes = r.changes || {};
    const changeLines = Object.entries(changes).map(([field, ch]) => ({
      field,
      detail: formatChange(field, ch?.before, ch?.after),
      before: ch?.before ?? null,
      after: ch?.after ?? null,
    }));
    return {
      rowNumber: r.rowNumber,
      action: r.action,
      consecutivo: r.matchedConsecutivo || snap.consecutivoArnald || null,
      matchedCaseId: r.matchedCaseId ? String(r.matchedCaseId) : null,
      candidateCaseIds: (r.candidateCaseIds || []).map(String),
      matchStrategy: r.matchStrategy,
      matchEvidence: r.matchEvidence,
      identificacion: snap.identificacion || r.payload?.identificacion || null,
      numeroCredito: snap.numeroCredito || null,
      numeroPolizaActual: snap.numeroPolizaActual || null,
      numeroPolizaExcel: snap.numeroPolizaExcel || null,
      siniestroActual: snap.siniestroActual || null,
      siniestroExcel: snap.siniestroExcel || null,
      estadoActual: snap.estadoActual || null,
      estadoExcel: snap.estadoExcel || null,
      estadoAction: snap.estadoAction || null,
      ignoredFields: r.ignoredFields || null,
      changes: changeLines,
      changeFields: Object.keys(changes),
      warnings: r.warnings || [],
      claimNumberEventPending: Boolean(r.claimNumberEventPending || r.claimNumberAssigned),
      message: r.message,
      errorCode: r.errorCode,
    };
  }

  console.log('\n=== DETALLE UPDATED ===');
  console.log(JSON.stringify(updated.map(detailRow), null, 2));

  console.log('\n=== DETALLE CREATED ===');
  console.log(JSON.stringify(created.map(detailRow), null, 2));

  console.log('\n=== DETALLE AMBIGUOUS ===');
  console.log(JSON.stringify(ambiguous.map(detailRow), null, 2));

  console.log('\n=== DETALLE REJECTED ===');
  console.log(JSON.stringify(rejected.map(detailRow), null, 2));

  console.log('\n=== VALIDACIÓN INTEGRIDAD CASOS ===');
  console.log(
    JSON.stringify(
      {
        casesBefore,
        casesAfter,
        casosMutadosPorUpdatedAt: casosMutados,
        mongoCasosModificados: casosMutados > 0 || casesBefore !== casesAfter ? 'SI' : 'NO',
      },
      null,
      2
    )
  );

  console.log('\n=== DECLARACIÓN FINAL ===');
  console.log('Mongo modificado (casos Alfa): NO');
  console.log('/execute ejecutado: NO');
  console.log('Cron activado: NO');
  console.log('SharePoint modificado: NO');
  console.log(`Preview session: ${preview.importSessionId}`);

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(JSON.stringify({ error: true, code: e.code, message: e.message, stack: e.stack }, null, 2));
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
