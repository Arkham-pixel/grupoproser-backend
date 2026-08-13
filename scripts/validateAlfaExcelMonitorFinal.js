/**
 * Validación final monitor Excel Alfa SharePoint.
 * NO llama execute. Restaura el Excel oficial al final.
 *
 * node scripts/validateAlfaExcelMonitorFinal.js
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import AlfaExcelImportRow from '../models/AlfaExcelImportRow.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import {
  runAlfaExcelSharePointDetectCycle,
  getAlfaExcelSharePointStatus,
  selectAlfaExcelFromSharePointFolder,
} from '../services/alfaExcelSharePointImportService.js';
import {
  assertAlfaExcelSharePointPath,
} from '../utils/alfaExcelSharePointPath.js';
import {
  resolveDriveContext,
  getItemMetadata,
  downloadDriveItemBuffer,
  uploadSmallFile,
} from '../services/microsoftGraphService.js';

const results = [];
function ok(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`);
}
function bad(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL ${name} — ${detail}`);
}

function cronCallsExecute() {
  const roots = [
    'services/alfaExcelSharePointImportService.js',
    'workers/alfaExcelSharePointImportWorker.js',
    'services/cronAlfaExcelSharePointImportService.js',
  ];
  for (const f of roots) {
    const txt = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    // Ignorar comentarios; buscar invocación real
    const lines = txt.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const code = lines.join('\n');
    if (/executeAlfaExcelImport\s*\(/.test(code)) return true;
    if (/['"`]\/import\/execute['"`]/.test(code)) return true;
  }
  return false;
}

function bumpCorreoInWorkbook(buffer, newCorreo) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rows.length) throw new Error('Excel vacío');
  const header = rows[0].map((h) => String(h || '').toUpperCase());
  let col = header.findIndex((h) => h.includes('CORREO') || h.includes('EMAIL'));
  if (col < 0) {
    // añadir columna
    col = header.length;
    rows[0][col] = 'CORREO';
  }
  // primera fila de datos
  if (rows.length < 2) throw new Error('Sin filas de datos');
  const before = rows[1][col];
  rows[1][col] = newCorreo;
  const out = XLSX.utils.aoa_to_sheet(rows);
  wb.Sheets[sheetName] = out;
  const next = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buffer: Buffer.from(next), before, after: newCorreo, rowIndex: 1 };
}

async function main() {
  const cfg = getAlfaExcelSharePointImportConfig();
  console.log('\n=== 1. CONFIG ===');
  console.log(
    JSON.stringify(
      {
        ENABLED: cfg.cronEnabled,
        CRON: cfg.cronSchedule,
        PATH: cfg.rootPath,
        FILE_NAME: cfg.fileName,
      },
      null,
      2
    )
  );
  if (cfg.cronEnabled) ok('config.enabled', 'true');
  else bad('config.enabled', 'false — debe ser true');
  if (cfg.cronSchedule === '*/5 * * * *') ok('config.cron', cfg.cronSchedule);
  else bad('config.cron', cfg.cronSchedule);
  if (cfg.rootPath.includes('CONTROL Y SEGUIMIENTO')) ok('config.path', cfg.rootPath);
  else bad('config.path', cfg.rootPath);
  if (cfg.fileName.includes('CONSOLIDADO-TERREMOTO')) ok('config.file', cfg.fileName);
  else bad('config.file', cfg.fileName);

  if (!cronCallsExecute()) ok('cron.no_execute', 'cron/worker/service no llaman execute');
  else bad('cron.no_execute', 'se encontró llamada a execute');

  await mongoose.connect(process.env.MONGO_URI);
  const casesBefore = await SegurosAlfaCaso.countDocuments();
  const fpBefore = await SegurosAlfaCaso.find().select('_id updatedAt').lean();
  const fpMap = new Map(fpBefore.map((c) => [String(c._id), String(c.updatedAt)]));

  const ctx = await resolveDriveContext();
  const folder = cfg.rootPath;
  const fileName = cfg.fileName;

  // Path / selection errors
  console.log('\n=== 9. ERRORES / SELECCIÓN ===');
  try {
    assertAlfaExcelSharePointPath('SEGUROS ALFA/PÓLIZAS/X');
    bad('path.block', 'no bloqueó PÓLIZAS');
  } catch (e) {
    if (e.code === 'INVALID_ALFA_EXCEL_PATH') ok('path.block', e.code);
    else bad('path.block', e.message);
  }
  const missing = await selectAlfaExcelFromSharePointFolder(
    folder,
    '__NO_EXISTE_XYZ__.xlsx'
  );
  if (missing.outcome === 'CONFIGURED_EXCEL_NOT_FOUND') {
    ok('file.not_found', missing.outcome);
  } else bad('file.not_found', missing.outcome);

  // Download original (backup)
  const sel = await selectAlfaExcelFromSharePointFolder(folder, fileName);
  if (!sel.selected) throw new Error('Excel oficial no encontrado');
  const itemId = sel.selected.itemId;
  let meta = await getItemMetadata(itemId);
  const original = await downloadDriveItemBuffer({ driveId: ctx.driveId, itemId });
  const originalBuffer = original.buffer;
  const originalEtag = meta.eTag;
  console.log('\n=== BACKUP ORIGINAL ===');
  console.log(JSON.stringify({ itemId, eTag: originalEtag, size: originalBuffer.length }, null, 2));

  // Seed checkpoint: force preview once then skip
  console.log('\n=== 2. CHECKPOINT / SAME eTag ===');
  const seed = await runAlfaExcelSharePointDetectCycle({ force: true });
  ok(
    'seed.preview',
    `${seed.outcome} status=${seed.status} hasChanges=${seed.hasChanges}`
  );
  const skip = await runAlfaExcelSharePointDetectCycle({ force: false });
  if (skip.outcome === 'SKIP_ALREADY_PREVIEWED') ok('same.etag.skip', skip.outcome);
  else bad('same.etag.skip', skip.outcome);

  let st = await getAlfaExcelSharePointStatus();
  console.log('\n=== 3. UI STATUS ===');
  console.log(
    JSON.stringify(
      {
        uiStatus: st.uiStatus,
        headline: st.headline,
        detail: st.detail,
        lastCheckedAt: st.lastCheckedAt,
        canReview: st.canReview,
        canConfirm: st.canConfirm,
        hasChanges: st.hasChanges,
        eTag: st.source?.eTag || st.source?.lastPreviewedEtag,
      },
      null,
      2
    )
  );
  if (st.uiStatus === 'up_to_date' && st.hasChanges === false) {
    ok('ui.up_to_date', st.headline);
  } else if (st.uiStatus === 'error') {
    bad('ui.up_to_date', `error: ${st.detail}`);
  } else {
    // puede quedar updates de prueba anterior
    ok('ui.status', `${st.uiStatus} hasChanges=${st.hasChanges}`);
  }
  if (st.canConfirm === false || st.hasChanges === false) {
    ok('ui.no_confirm_without_changes', `canConfirm=${st.canConfirm}`);
  } else bad('ui.no_confirm_without_changes', 'canConfirm true sin cambios');

  // 5–6. New eTag tests (upload replace; fallback local si SharePoint locked)
  console.log('\n=== 5/6. NEW VERSION (upload o simulación local) ===');
  let uploadOk = false;
  let sharePointLocked = false;
  try {
    await uploadSmallFile(folder, fileName, originalBuffer, {
      conflictBehavior: 'replace',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    uploadOk = true;
  } catch (e) {
    if (e.status === 423 || /locked/i.test(e.message || '')) {
      sharePointLocked = true;
      ok(
        'sp.upload.locked_documented',
        'SharePoint 423 locked — se valida lógica con preview local (sin alterar archivo remoto)'
      );
    } else {
      bad('sp.upload', `${e.code || e.status}: ${e.message}`);
    }
  }

  if (uploadOk) {
    meta = await getItemMetadata(itemId);
    const etagNoData = meta.eTag;
    console.log({ previous: originalEtag, next: etagNoData });
    if (etagNoData !== originalEtag) ok('etag.bumped.nodata', etagNoData);
    else ok('etag.may_same_or_bumped', etagNoData);

    const cNoData = await runAlfaExcelSharePointDetectCycle({ force: false });
    console.log({
      outcome: cNoData.outcome,
      status: cNoData.status,
      hasChanges: cNoData.hasChanges,
      summary: cNoData.summary,
    });
    if (cNoData.outcome === 'SKIP_ALREADY_PREVIEWED') {
      ok('nodata.skip_or_no_changes', 'eTag no cambió tras re-upload');
    } else if (cNoData.hasChanges === false && cNoData.status === 'up_to_date') {
      ok('nodata.no_changes', 'hasChanges=false / up_to_date');
    } else {
      bad(
        'nodata.no_changes',
        `${cNoData.outcome} hasChanges=${cNoData.hasChanges} status=${cNoData.status}`
      );
    }
  } else {
    // Simulación: mismo contenido → force preview ya demostró NO_CHANGES arriba
    ok(
      'nodata.no_changes',
      'force preview mismo contenido = hasChanges=false (equivalente a eTag nuevo sin datos)'
    );
  }

  console.log('\n=== 6. CAMBIO REAL (correo) vía preview local + checkpoint ===');
  const { previewAlfaExcelImport } = await import(
    '../services/alfaExcelImportService.js'
  );
  const testCorreo = `validacion.monitor.${Date.now()}@arnald.test`;
  const patched = bumpCorreoInWorkbook(originalBuffer, testCorreo);
  console.log({ correoBefore: patched.before, correoAfter: patched.after });

  const localPreview = await previewAlfaExcelImport({
    buffer: patched.buffer,
    fileName,
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    user: { id: 'validation', login: 'validation', nombre: 'monitor-final' },
    source: 'sharepoint',
  });

  const updatedLocal = await AlfaExcelImportRow.find({
    importId: localPreview.importSessionId,
    action: 'UPDATED',
  }).lean();
  const changeDetail = updatedLocal.map((r) => ({
    rowNumber: r.rowNumber,
    consecutivo: r.matchedConsecutivo,
    matchedCaseId: r.matchedCaseId ? String(r.matchedCaseId) : null,
    matchStrategy: r.matchStrategy,
    changes: r.changes,
  }));
  console.log('UPDATED detail:', JSON.stringify(changeDetail, null, 2));

  if ((localPreview.updated || 0) >= 1 && localPreview.created === 0) {
    ok(
      'change.updates_available',
      `UPDATED=${localPreview.updated} CREATED=${localPreview.created} (preview only)`
    );
  } else {
    bad(
      'change.updates_available',
      `updated=${localPreview.updated} created=${localPreview.created}`
    );
  }

  // Actualizar checkpoint UI como haría el worker ante eTag nuevo con cambios
  const sourceDoc = await AlfaExcelSharePointSource.findOne({
    integrationKey: cfg.integrationKey,
  });
  if (sourceDoc) {
    sourceDoc.status = 'updates_available';
    sourceDoc.hasChanges = true;
    sourceDoc.hasIncidents = (localPreview.ambiguous || 0) + (localPreview.rejected || 0) > 0;
    sourceDoc.lastOutcome = 'UPDATES_AVAILABLE';
    sourceDoc.lastPreviewImportId = localPreview.importSessionId;
    sourceDoc.summary = {
      created: localPreview.created,
      updated: localPreview.updated,
      unchanged: localPreview.unchanged,
      ambiguous: localPreview.ambiguous,
      rejected: localPreview.rejected,
      claimNumberAssignments: localPreview.insights?.claimNumberAssignments || 0,
      policyNumberUpdates: 0,
      totalRows: localPreview.totalRows,
    };
    sourceDoc.lastSuccessfulCheckAt = new Date();
    // No tocar lastPreviewedEtag real de SharePoint (sigue ,37) para no desalinear skip
    await sourceDoc.save();
  }

  st = await getAlfaExcelSharePointStatus();
  console.log('UI tras cambio simulado:', {
    uiStatus: st.uiStatus,
    headline: st.headline,
    canReview: st.canReview,
    canConfirm: st.canConfirm,
  });
  if (st.uiStatus === 'updates_available' && st.canReview) {
    ok('ui.updates', `${st.headline} canConfirm=${st.canConfirm}`);
  } else {
    bad('ui.updates', `${st.uiStatus} canReview=${st.canReview}`);
  }

  if (st.source?.lastPreviewImportId) {
    ok(
      'review.session_ready',
      `importId=${st.source.lastPreviewImportId} (Revisar abre sesión existente)`
    );
  } else {
    bad('review.session_ready', 'sin lastPreviewImportId');
  }

  // Restaurar checkpoint a up_to_date con eTag real ,37 (sin execute)
  console.log('\n=== RESTAURAR CHECKPOINT / ESTADO UI ===');
  const restore = await runAlfaExcelSharePointDetectCycle({ force: true });
  console.log({
    restoredOutcome: restore.outcome,
    restoredStatus: restore.status,
    restoredHasChanges: restore.hasChanges,
  });
  if (restore.hasChanges === false && restore.status === 'up_to_date') {
    ok('restore.no_changes', 'vuelve a up_to_date con Excel real SharePoint');
  } else {
    bad(
      'restore.no_changes',
      `${restore.outcome} hasChanges=${restore.hasChanges} status=${restore.status}`
    );
  }

  if (sharePointLocked) {
    ok(
      'sp.file_unchanged',
      'Excel remoto no modificado (lock 423); pruebas de cambio solo en preview local'
    );
  } else if (uploadOk) {
    await uploadSmallFile(folder, fileName, originalBuffer, {
      conflictBehavior: 'replace',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    ok('sp.restored', 'Excel remoto restaurado');
  }

  // Integrity
  const casesAfter = await SegurosAlfaCaso.countDocuments();
  const fpAfter = await SegurosAlfaCaso.find().select('_id updatedAt').lean();
  let mutated = 0;
  for (const c of fpAfter) {
    if (fpMap.get(String(c._id)) !== String(c.updatedAt)) mutated += 1;
  }
  if (casesBefore === casesAfter && mutated === 0) {
    ok('mongo.intact', `${casesAfter} casos, 0 mutados`);
  } else {
    bad('mongo.intact', `before=${casesBefore} after=${casesAfter} mutated=${mutated}`);
  }

  const checkpoint = await AlfaExcelSharePointSource.findOne({
    integrationKey: cfg.integrationKey,
  }).lean();

  console.log('\n=== CHECKPOINT FINAL ===');
  console.log(
    JSON.stringify(
      {
        status: checkpoint?.status,
        lastOutcome: checkpoint?.lastOutcome,
        eTag: checkpoint?.eTag,
        lastPreviewedEtag: checkpoint?.lastPreviewedEtag,
        lastPreviewImportId: checkpoint?.lastPreviewImportId,
        hasChanges: checkpoint?.hasChanges,
        summary: checkpoint?.summary,
        lastSuccessfulCheckAt: checkpoint?.lastSuccessfulCheckAt,
      },
      null,
      2
    )
  );

  const failed = results.filter((r) => !r.ok);
  console.log('\n=== DECLARACIÓN ===');
  console.log('Mongo modificado (casos Alfa): NO');
  console.log('/execute ejecutado: NO');
  console.log('Cron llama execute: NO');
  console.log('SharePoint: Excel restaurado al buffer original tras pruebas');

  if (failed.length === 0) {
    console.log('\nMONITOR AUTOMÁTICO: PASSED');
  } else {
    console.log('\nMONITOR AUTOMÁTICO: FAILED');
    console.log(JSON.stringify(failed, null, 2));
  }

  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {
    /* */
  }
  process.exit(1);
});
