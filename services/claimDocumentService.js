/**
 * Servicio de metadatos ClaimDocument.
 * No llama a Microsoft Graph ni a S3 (solo Mongo).
 */

import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';
import { isValidDocumentType } from '../config/claimDocumentTypes.js';
import { sanitizeStoredFileName } from '../utils/sharepointClaimPath.js';
import {
  getSharePointSyncConfig,
  getNextRetryAt,
  isSyncModuleEnabled,
} from '../config/sharepointSync.js';

function assertObjectId(id, field = 'id') {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const err = new Error(`${field} inválido`);
    err.code = 'INVALID_ID';
    throw err;
  }
}

function sanitizeErrorPayload(error = {}) {
  const message = String(error.message || error.Message || 'Error desconocido').slice(0, 1000);
  return {
    code: String(error.code || 'UNKNOWN').slice(0, 120),
    message,
    status: Number.isFinite(error.status) ? error.status : undefined,
  };
}

/**
 * Crea registro documental (estado sync pendiente o disabled).
 */
export async function createDocumentRecord(input = {}) {
  const {
    sourceModule,
    claimId,
    claimNumber,
    insurer,
    documentType,
    originalName,
    storedName,
    mimeType,
    size,
    checksum,
    storage,
    uploadedBy,
    uploadedByLogin,
    uploadedByName,
    sharepointEnabled = true,
  } = input;

  if (!sourceModule) {
    const err = new Error('sourceModule es obligatorio');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  assertObjectId(claimId, 'claimId');
  if (!claimNumber || !insurer) {
    const err = new Error('claimNumber e insurer son obligatorios');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (!isValidDocumentType(documentType)) {
    const err = new Error(`documentType no permitido: ${documentType}`);
    err.code = 'INVALID_DOCUMENT_TYPE';
    throw err;
  }
  if (!originalName) {
    const err = new Error('originalName es obligatorio');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (!storage?.bucket || !storage?.key) {
    const err = new Error('storage.bucket y storage.key son obligatorios');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (uploadedBy) assertObjectId(uploadedBy, 'uploadedBy');

  const doc = await ClaimDocument.create({
    sourceModule,
    claimId,
    claimNumber: String(claimNumber).trim(),
    insurer: String(insurer).trim(),
    documentType,
    originalName: String(originalName).trim(),
    storedName: storedName || sanitizeStoredFileName(originalName),
    mimeType,
    size,
    checksum: checksum || undefined,
    storage: {
      provider: 's3',
      bucket: storage.bucket,
      key: storage.key,
      etag: storage.etag,
    },
    sharepoint: {
      enabled: Boolean(sharepointEnabled),
      syncStatus: sharepointEnabled ? 'pending' : 'disabled',
      attempts: 0,
    },
    uploadedBy: uploadedBy || undefined,
    uploadedByLogin: uploadedByLogin || undefined,
    uploadedByName: uploadedByName || undefined,
    status: 'active',
  });

  return doc;
}

export async function getDocumentById(id) {
  assertObjectId(id, 'documentId');
  return ClaimDocument.findById(id);
}

/**
 * Documentos elegibles para el worker (pending + failed con retry).
 * Solo módulos en SHAREPOINT_SYNC_ENABLED_MODULES (piloto: alfa).
 */
export async function getPendingDocuments({ limit, now = new Date(), sourceModules } = {}) {
  const { maxAttempts, batchSize, enabledModules } = getSharePointSyncConfig();
  const lim = Math.min(Math.max(Number(limit) || batchSize, 1), 500);
  const at = now instanceof Date ? now : new Date(now);
  const candidates = Array.isArray(sourceModules) && sourceModules.length
    ? sourceModules
    : enabledModules;
  const modules = candidates.filter((m) => isSyncModuleEnabled(m));
  if (!modules.length) return [];

  return ClaimDocument.find({
    status: 'active',
    sourceModule: { $in: modules },
    'sharepoint.enabled': true,
    'sharepoint.attempts': { $lt: maxAttempts },
    $or: [
      { 'sharepoint.syncStatus': 'pending' },
      {
        'sharepoint.syncStatus': 'failed',
        $or: [
          { 'sharepoint.nextRetryAt': { $exists: false } },
          { 'sharepoint.nextRetryAt': null },
          { 'sharepoint.nextRetryAt': { $lte: at } },
        ],
      },
    ],
  })
    .sort({ 'sharepoint.nextRetryAt': 1, 'sharepoint.lastAttemptAt': 1, createdAt: 1 })
    .limit(lim);
}

/**
 * Adquisición atómica: pending|failed → syncing e incrementa attempts.
 * @returns {{ ok: true, document } | { ok: false, reason }}
 */
export async function acquireSyncLock(documentId, { now = new Date() } = {}) {
  assertObjectId(documentId, 'documentId');
  const { maxAttempts } = getSharePointSyncConfig();
  const at = now instanceof Date ? now : new Date(now);

  const existing = await ClaimDocument.findById(documentId).lean();
  if (!existing) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  if (existing.status !== 'active' || !existing.sharepoint?.enabled) {
    return { ok: false, reason: 'NOT_ELIGIBLE' };
  }
  // FASE 7: no adquirir lock de módulos fuera de la lista blanca
  if (!isSyncModuleEnabled(existing.sourceModule)) {
    return { ok: false, reason: 'SKIP_MODULE_DISABLED', document: existing };
  }
  if (existing.sharepoint?.syncStatus === 'synced' && existing.sharepoint?.itemId) {
    return { ok: false, reason: 'SKIPPED_ALREADY_SYNCED', document: existing };
  }
  if (Number(existing.sharepoint?.attempts || 0) >= maxAttempts) {
    return { ok: false, reason: 'SKIP_MAX_ATTEMPTS', document: existing };
  }
  if (!['pending', 'failed'].includes(existing.sharepoint?.syncStatus)) {
    return { ok: false, reason: 'SKIP_ALREADY_PROCESSING', document: existing };
  }
  if (
    existing.sharepoint?.syncStatus === 'failed' &&
    existing.sharepoint?.nextRetryAt &&
    new Date(existing.sharepoint.nextRetryAt) > at
  ) {
    return { ok: false, reason: 'SKIP_RETRY_NOT_DUE', document: existing };
  }

  const doc = await ClaimDocument.findOneAndUpdate(
    {
      _id: documentId,
      status: 'active',
      sourceModule: existing.sourceModule,
      'sharepoint.enabled': true,
      'sharepoint.syncStatus': { $in: ['pending', 'failed'] },
      'sharepoint.attempts': { $lt: maxAttempts },
      $or: [
        { 'sharepoint.syncStatus': 'pending' },
        { 'sharepoint.nextRetryAt': { $exists: false } },
        { 'sharepoint.nextRetryAt': null },
        { 'sharepoint.nextRetryAt': { $lte: at } },
      ],
    },
    {
      $set: {
        'sharepoint.syncStatus': 'syncing',
        'sharepoint.lastAttemptAt': at,
      },
      $inc: { 'sharepoint.attempts': 1 },
      $unset: {
        'sharepoint.nextRetryAt': '',
        'sharepoint.lastError': '',
      },
    },
    { new: true }
  );

  if (!doc) {
    return { ok: false, reason: 'SKIP_ALREADY_PROCESSING' };
  }
  return { ok: true, document: doc };
}

/**
 * pending|failed → syncing (sin $inc). Preferir acquireSyncLock en el worker.
 * Conservado por compatibilidad con pruebas FASE 4.
 */
export async function markSyncing(documentId) {
  assertObjectId(documentId, 'documentId');
  const doc = await ClaimDocument.findById(documentId);
  if (!doc) {
    const err = new Error('ClaimDocument no encontrado');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (doc.sharepoint?.syncStatus === 'synced' && doc.sharepoint?.itemId) {
    return doc;
  }

  doc.sharepoint = doc.sharepoint || {};
  doc.sharepoint.syncStatus = 'syncing';
  doc.sharepoint.lastAttemptAt = new Date();
  await doc.save();
  return doc;
}

/**
 * Marca sincronización exitosa con metadatos Graph (sin secretos).
 */
export async function markSynced(documentId, sharepointMeta = {}) {
  assertObjectId(documentId, 'documentId');
  const doc = await ClaimDocument.findById(documentId);
  if (!doc) {
    const err = new Error('ClaimDocument no encontrado');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const $set = {
    'sharepoint.syncStatus': 'synced',
    'sharepoint.syncedAt': new Date(),
    'sharepoint.lastAttemptAt': new Date(),
  };
  if (sharepointMeta.siteId != null) $set['sharepoint.siteId'] = sharepointMeta.siteId;
  if (sharepointMeta.driveId != null) $set['sharepoint.driveId'] = sharepointMeta.driveId;
  if (sharepointMeta.itemId != null) $set['sharepoint.itemId'] = sharepointMeta.itemId;
  if (sharepointMeta.parentItemId != null) {
    $set['sharepoint.parentItemId'] = sharepointMeta.parentItemId;
  }
  if (sharepointMeta.path != null) $set['sharepoint.path'] = sharepointMeta.path;
  if (sharepointMeta.webUrl != null) $set['sharepoint.webUrl'] = sharepointMeta.webUrl;

  const updated = await ClaimDocument.findByIdAndUpdate(
    documentId,
    {
      $set,
      $unset: {
        'sharepoint.lastError': '',
        'sharepoint.nextRetryAt': '',
      },
    },
    { new: true }
  );

  return updated;
}

/**
 * Marca fallo. NO incrementa attempts (se incrementan al adquirir el lock).
 */
export async function markSyncFailed(documentId, error = {}) {
  assertObjectId(documentId, 'documentId');
  const doc = await ClaimDocument.findById(documentId);
  if (!doc) {
    const err = new Error('ClaimDocument no encontrado');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const { maxAttempts } = getSharePointSyncConfig();
  const attempts = Number(doc.sharepoint?.attempts || 0);

  doc.sharepoint = doc.sharepoint || {};
  doc.sharepoint.syncStatus = 'failed';
  doc.sharepoint.lastAttemptAt = new Date();
  doc.sharepoint.lastError = sanitizeErrorPayload(error);

  if (attempts >= maxAttempts) {
    doc.set('sharepoint.nextRetryAt', undefined);
    doc.sharepoint.lastError.message = `${doc.sharepoint.lastError.message} | REQUIERE_INTERVENCION (attempts>=${maxAttempts})`.slice(
      0,
      1000
    );
  } else {
    doc.sharepoint.nextRetryAt = getNextRetryAt(attempts);
  }

  doc.markModified('sharepoint');
  await doc.save();
  return doc;
}

/**
 * Documentos stuck en syncing más allá de staleMinutes → failed (reintentables).
 * No toca S3 ni SharePoint. Si hay itemId, no lo borra.
 */
export async function recoverStaleSyncDocuments({ now = new Date() } = {}) {
  const { staleMinutes, enabledModules } = getSharePointSyncConfig();
  const at = now instanceof Date ? now : new Date(now);
  const cutoff = new Date(at.getTime() - staleMinutes * 60 * 1000);
  const modules = enabledModules.filter((m) => isSyncModuleEnabled(m));
  if (!modules.length) return [];

  const stale = await ClaimDocument.find({
    status: 'active',
    sourceModule: { $in: modules },
    'sharepoint.enabled': true,
    'sharepoint.syncStatus': 'syncing',
    'sharepoint.lastAttemptAt': { $lt: cutoff },
  }).limit(100);

  const recovered = [];
  for (const doc of stale) {
    const attempts = Number(doc.sharepoint?.attempts || 0);
    doc.sharepoint.syncStatus = 'failed';
    doc.sharepoint.lastError = {
      code: 'STALE_SYNCING',
      message: `Proceso syncing abandonado (lastAttemptAt < now - ${staleMinutes}m)`,
    };
    doc.sharepoint.nextRetryAt = getNextRetryAt(Math.max(attempts, 1));
    doc.sharepoint.lastAttemptAt = at;
    doc.markModified('sharepoint');
    await doc.save();
    recovered.push(doc);
  }

  return recovered;
}

/** Soft delete documental (no borra S3 ni SharePoint en esta fase). */
export async function markDeleted(documentId) {
  assertObjectId(documentId, 'documentId');
  const doc = await ClaimDocument.findById(documentId);
  if (!doc) {
    const err = new Error('ClaimDocument no encontrado');
    err.code = 'NOT_FOUND';
    throw err;
  }
  doc.status = 'deleted';
  await doc.save();
  return doc;
}

export { getNextRetryAt };
