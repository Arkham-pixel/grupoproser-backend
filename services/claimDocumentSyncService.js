/**
 * Orquestación ClaimDocument: Mongo → S3 → SharePoint → Mongo.
 * Reutiliza sharepointSyncService (no duplica Graph/S3).
 */

import { getSharePointConfig } from '../config/sharepoint.js';
import {
  getSharePointSyncConfig,
  canUseSiniestrosPath,
  isSyncModuleEnabled,
} from '../config/sharepointSync.js';
import { getSharePointTestRoot } from '../utils/sharepointTestPath.js';
import { buildSharePointClaimPath } from '../utils/sharepointClaimPath.js';
import { buildAlfaSiniestrosDocumentPath } from '../utils/alfaDocumentPath.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  acquireSyncLock,
  getDocumentById,
  markSynced,
  markSyncFailed,
} from './claimDocumentService.js';
import { syncS3ObjectToSharePoint, SyncError } from './sharepointSyncService.js';
import { getItemMetadata } from './microsoftGraphService.js';

function logSync(event, payload = {}) {
  const safe = {
    event,
    documentId: payload.documentId ? String(payload.documentId) : undefined,
    claimNumber: payload.claimNumber,
    sourceModule: payload.sourceModule,
    storageKey: payload.storageKey,
    destinationPath: payload.destinationPath,
    attempt: payload.attempt,
    durationMs: payload.durationMs,
    result: payload.result,
    errorCode: payload.errorCode,
  };
  console.log(`[claimDocumentSync] ${JSON.stringify(safe)}`);
}

/**
 * Destino Alfa: SINIESTROS/{cedula}/{SUBCARPETA}
 * Reutiliza la carpeta que ya creó la aseguradora.
 */
async function resolveAlfaDestinationFolder(doc) {
  let identificacion = doc.alfaIdentificacion;

  if (doc.claimId) {
    const caso = await SegurosAlfaCaso.findById(doc.claimId)
      .select('identificacion')
      .lean();
    if (caso) {
      identificacion = caso.identificacion || identificacion;
    }
  }

  const built = buildAlfaSiniestrosDocumentPath({
    identificacion,
    documentType: doc.documentType,
  });

  if (!built.ok) {
    const err = new Error(built.reason || 'PENDING_DESTINATION');
    err.code = built.code || 'PENDING_DESTINATION';
    err.reason = built.reason;
    throw err;
  }

  return built.path;
}

function resolveDestinationFolder(doc) {
  const cfg = getSharePointSyncConfig();

  // Alfa pilot: SINIESTROS/{cedula} (async en syncClaimDocument)
  if (canUseSiniestrosPath(doc) && doc.sourceModule === 'alfa') {
    return null; // señal: usar resolveAlfaDestinationFolder
  }

  // Modo test / forceTestRoot: solo TEST_ARNALD
  if (cfg.mode === 'test' || cfg.forceTestRoot) {
    const root = getSharePointTestRoot();
    const testFolder = cfg.testWorkerFolder || 'WORKER_TEST';
    return buildSharePointClaimPath({
      insurer: doc.insurer,
      claimNumber: doc.claimNumber,
      documentType: doc.documentType,
      rootPrefix: `${root}/${testFolder}`,
    });
  }

  const root = getSharePointTestRoot();
  return buildSharePointClaimPath({
    insurer: doc.insurer,
    claimNumber: doc.claimNumber,
    documentType: doc.documentType,
    rootPrefix: `${root}/${cfg.testWorkerFolder || 'WORKER_TEST'}`,
  });
}

/**
 * Sincroniza un ClaimDocument pendiente/fallido hacia SharePoint.
 * @returns {{ result: string, document?: object, error?: object }}
 */
export async function syncClaimDocument(documentId, { now = new Date() } = {}) {
  const started = Date.now();

  const before = await getDocumentById(documentId);
  if (!before) {
    return { result: 'NOT_FOUND' };
  }

  if (!isSyncModuleEnabled(before.sourceModule)) {
    logSync('skip', {
      documentId,
      claimNumber: before.claimNumber,
      sourceModule: before.sourceModule,
      result: 'SKIP_MODULE_DISABLED',
      durationMs: Date.now() - started,
    });
    return { result: 'SKIP_MODULE_DISABLED', document: before };
  }

  if (
    before.sharepoint?.syncStatus === 'synced' &&
    before.sharepoint?.itemId
  ) {
    logSync('skip', {
      documentId,
      claimNumber: before.claimNumber,
      sourceModule: before.sourceModule,
      result: 'SKIPPED',
      durationMs: Date.now() - started,
    });
    return { result: 'SKIPPED', document: before };
  }

  // Sin cédula: no crear carpeta; esperar identificación
  if (
    before.sourceModule === 'alfa' &&
    before.destinationStatus === 'pending_destination'
  ) {
    logSync('skip', {
      documentId,
      claimNumber: before.claimNumber,
      sourceModule: before.sourceModule,
      result: 'PENDING_DESTINATION',
      errorCode: before.destinationReason || 'MISSING_IDENTIFICATION',
      durationMs: Date.now() - started,
    });
    return { result: 'PENDING_DESTINATION', document: before };
  }

  // itemId presente pero estado inconsistente: validar en Graph antes de re-subir
  if (before.sharepoint?.itemId && before.sharepoint?.syncStatus !== 'synced') {
    try {
      const meta = await getItemMetadata(before.sharepoint.itemId);
      if (meta?.id) {
        const spCfg = getSharePointConfig();
        const doc = await markSynced(documentId, {
          siteId: spCfg.siteId || before.sharepoint.siteId,
          driveId: spCfg.driveId || before.sharepoint.driveId,
          itemId: meta.id,
          parentItemId: meta.parentReference?.id,
          path: before.sharepoint.path,
          webUrl: meta.webUrl,
        });
        logSync('reconcile', {
          documentId,
          claimNumber: before.claimNumber,
          sourceModule: before.sourceModule,
          result: 'SKIPPED_RECONCILED',
          durationMs: Date.now() - started,
        });
        return { result: 'SKIPPED_RECONCILED', document: doc };
      }
    } catch {
      // itemId inválido: continuar a re-sincronizar
    }
  }

  const lock = await acquireSyncLock(documentId, { now });
  if (!lock.ok) {
    logSync('skip', {
      documentId,
      claimNumber: before.claimNumber,
      sourceModule: before.sourceModule,
      result: lock.reason,
      durationMs: Date.now() - started,
    });
    return { result: lock.reason, document: lock.document || before };
  }

  const doc = lock.document;

  let destinationPath;
  try {
    if (doc.sourceModule === 'alfa' && canUseSiniestrosPath(doc)) {
      destinationPath = await resolveAlfaDestinationFolder(doc);
      // Si estaba pending y ahora hay path, marcar ready
      if (doc.destinationStatus === 'pending_destination') {
        doc.destinationStatus = 'ready';
        doc.destinationReason = undefined;
        await doc.save();
      }
    } else {
      destinationPath = resolveDestinationFolder(doc);
    }
  } catch (error) {
    if (
      error?.code === 'PENDING_DESTINATION' ||
      error?.code === 'MISSING_IDENTIFICATION' ||
      error?.code === 'MISSING_REAL_POLICY_NUMBER'
    ) {
      doc.destinationStatus = 'pending_destination';
      doc.destinationReason = error.reason || error.code;
      if (doc.sharepoint) {
        doc.sharepoint.syncStatus = 'pending';
      }
      await doc.save();
      logSync('skip', {
        documentId,
        claimNumber: doc.claimNumber,
        sourceModule: doc.sourceModule,
        result: 'PENDING_DESTINATION',
        errorCode: doc.destinationReason,
        durationMs: Date.now() - started,
      });
      return { result: 'PENDING_DESTINATION', document: doc };
    }
    throw error;
  }

  if (!destinationPath) {
    const failed = await markSyncFailed(doc._id, {
      code: 'MISSING_DESTINATION_PATH',
      message: 'No se pudo resolver carpeta SharePoint',
    });
    return { result: 'ERROR', document: failed };
  }

  const fileName = doc.storedName || doc.originalName;
  const fullDestination = `${destinationPath}/${fileName}`;

  console.log(
    JSON.stringify({
      event: 'SHAREPOINT_DESTINATION_PATH',
      documentId: String(doc._id),
      sourceModule: doc.sourceModule,
      claimNumber: doc.claimNumber,
      claimNumberSource: doc.claimNumberSource || null,
      destinationFolder: destinationPath,
      destinationPath: fullDestination,
    })
  );

  logSync('start', {
    documentId: doc._id,
    claimNumber: doc.claimNumber,
    sourceModule: doc.sourceModule,
    storageKey: doc.storage?.key,
    destinationPath: fullDestination,
    attempt: doc.sharepoint?.attempts,
    result: 'syncing',
  });

  try {
    const syncResult = await syncS3ObjectToSharePoint({
      bucket: doc.storage.bucket,
      key: doc.storage.key,
      destinationPath,
      destinationFileName: fileName,
      mimeType: doc.mimeType,
      size: doc.size,
      conflictBehavior: 'replace',
      verifyHash: false,
      sourceModule: doc.sourceModule,
    });

    const spCfg = getSharePointConfig();
    const updated = await markSynced(doc._id, {
      siteId: spCfg.siteId,
      driveId: spCfg.driveId,
      itemId: syncResult.sharepoint.itemId,
      parentItemId: syncResult.sharepoint.parentReference?.id,
      path: syncResult.sharepoint.path,
      webUrl: syncResult.sharepoint.webUrl,
    });

    logSync('done', {
      documentId: doc._id,
      claimNumber: doc.claimNumber,
      sourceModule: doc.sourceModule,
      storageKey: doc.storage?.key,
      destinationPath: syncResult.sharepoint.path,
      attempt: updated.sharepoint?.attempts,
      durationMs: Date.now() - started,
      result: 'synced',
    });

    return { result: 'synced', document: updated, syncResult };
  } catch (error) {
    const code =
      error instanceof SyncError
        ? error.code
        : error?.code || 'SHAREPOINT_SYNC_ERROR';
    const failed = await markSyncFailed(doc._id, {
      code,
      message: error.message || String(error),
      status: error?.status || error?.cause?.status,
    });

    logSync('error', {
      documentId: doc._id,
      claimNumber: doc.claimNumber,
      sourceModule: doc.sourceModule,
      storageKey: doc.storage?.key,
      destinationPath: `${destinationPath}/${fileName}`,
      attempt: failed.sharepoint?.attempts,
      durationMs: Date.now() - started,
      result: 'failed',
      errorCode: code,
    });

    return { result: 'failed', document: failed, error: { code, message: error.message } };
  }
}
