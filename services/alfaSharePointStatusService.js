/**
 * Estado SharePoint para archivos Seguros Alfa (batch, sin Graph en request).
 */

import ClaimDocument from '../models/ClaimDocument.js';
import { parseS3KeyFromStoredPath } from '../utils/storageKeyBuilder.js';
import { buildAlfaIntegrationKey } from './alfaClaimDocumentEnqueueService.js';

const STATUS_UI = Object.freeze({
  pending: 'pending',
  syncing: 'syncing',
  synced: 'synced',
  failed: 'failed',
  disabled: 'disabled',
  none: 'none', // legacy / sin ClaimDocument
});

function mapClaimToSync(claim) {
  if (!claim) {
    return {
      enabled: false,
      status: STATUS_UI.none,
      attempts: 0,
      syncedAt: null,
      itemId: null,
      webUrl: null,
      lastErrorCode: null,
      claimDocumentId: null,
    };
  }

  const sp = claim.sharepoint || {};
  const status = sp.enabled === false ? STATUS_UI.disabled : sp.syncStatus || STATUS_UI.none;

  return {
    enabled: Boolean(sp.enabled),
    status:
      claim.destinationStatus === 'pending_destination'
        ? 'pending_destination'
        : status,
    destinationStatus: claim.destinationStatus || null,
    destinationReason: claim.destinationReason || null,
    attempts: Number(sp.attempts || 0),
    syncedAt: sp.syncedAt || null,
    itemId: status === 'synced' ? sp.itemId || null : null,
    webUrl: status === 'synced' ? sp.webUrl || null : null,
    path: sp.path || null,
    lastErrorCode: status === 'failed' ? sp.lastError?.code || null : null,
    claimDocumentId: String(claim._id),
  };
}

/**
 * Une archivos del caso con ClaimDocuments en una sola query.
 */
export async function buildAlfaSharePointDocumentsStatus(caso) {
  const archivos = Array.isArray(caso?.archivos) ? caso.archivos : [];
  const claimId = caso?._id;

  const keyByArchivoId = new Map();
  const s3Keys = [];

  for (const arch of archivos) {
    const archivoId = String(arch._id);
    const s3Key = parseS3KeyFromStoredPath(arch.ruta);
    if (s3Key) {
      keyByArchivoId.set(archivoId, s3Key);
      s3Keys.push(s3Key);
    } else {
      keyByArchivoId.set(archivoId, null);
    }
  }

  const uniqueKeys = [...new Set(s3Keys.filter(Boolean))];
  const claims = uniqueKeys.length
    ? await ClaimDocument.find({
        sourceModule: 'alfa',
        claimId,
        status: 'active',
        'storage.key': { $in: uniqueKeys },
      })
        .select(
          'storage.key integrationKey destinationStatus destinationReason sharepoint.enabled sharepoint.syncStatus sharepoint.attempts sharepoint.syncedAt sharepoint.itemId sharepoint.webUrl sharepoint.path sharepoint.lastError.code'
        )
        .lean()
    : [];

  const byKey = new Map();
  const byIntegration = new Map();
  for (const c of claims) {
    if (c.storage?.key) byKey.set(c.storage.key, c);
    if (c.integrationKey) byIntegration.set(c.integrationKey, c);
  }

  const documents = archivos.map((arch) => {
    const archivoId = String(arch._id);
    const s3Key = keyByArchivoId.get(archivoId);
    let claim = null;
    if (s3Key) {
      const ik = buildAlfaIntegrationKey(claimId, s3Key);
      claim = byIntegration.get(ik) || byKey.get(s3Key) || null;
    }

    return {
      archivoId,
      nombre: arch.nombreOriginal || arch.nombreArchivo || 'documento',
      etiqueta: arch.etiqueta || 'GENERAL',
      tamaño: arch.tamaño ?? null,
      fechaSubida: arch.fechaSubida || null,
      sync: mapClaimToSync(claim),
    };
  });

  const summary = {
    synced: 0,
    pending: 0,
    syncing: 0,
    failed: 0,
    disabled: 0,
    none: 0,
  };
  for (const d of documents) {
    const st = d.sync?.status || 'none';
    if (summary[st] != null) summary[st] += 1;
    else summary.none += 1;
  }

  return { documents, summary, total: documents.length };
}

/**
 * Marca ClaimDocument failed → elegible para retry (no sincroniza).
 */
export async function markAlfaClaimDocumentForRetry({ caso, archivoId }) {
  const archivo = caso.archivos?.id?.(archivoId);
  if (!archivo) {
    const err = new Error('Archivo no encontrado');
    err.code = 'ARCHIVO_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const s3Key = parseS3KeyFromStoredPath(archivo.ruta);
  if (!s3Key) {
    const err = new Error('El archivo no tiene key S3 resoluble');
    err.code = 'MISSING_S3_KEY';
    err.status = 400;
    throw err;
  }

  const integrationKey = buildAlfaIntegrationKey(caso._id, s3Key);
  const claim = await ClaimDocument.findOne({
    $or: [
      { integrationKey },
      {
        sourceModule: 'alfa',
        claimId: caso._id,
        status: 'active',
        'storage.key': s3Key,
      },
    ],
  });

  if (!claim) {
    const err = new Error('No hay ClaimDocument para este archivo (legacy / no encolado)');
    err.code = 'CLAIM_DOCUMENT_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  if (claim.sourceModule !== 'alfa') {
    const err = new Error('Documento no pertenece al módulo Alfa');
    err.code = 'INVALID_MODULE';
    err.status = 400;
    throw err;
  }

  if (claim.status !== 'active') {
    const err = new Error('Documento no está activo');
    err.code = 'NOT_ACTIVE';
    err.status = 400;
    throw err;
  }

  if (claim.sharepoint?.syncStatus === 'syncing') {
    const err = new Error('La sincronización ya está en curso');
    err.code = 'ALREADY_SYNCING';
    err.status = 409;
    throw err;
  }

  if (claim.sharepoint?.syncStatus === 'synced' && claim.sharepoint?.itemId) {
    const err = new Error('El documento ya está sincronizado');
    err.code = 'ALREADY_SYNCED';
    err.status = 409;
    throw err;
  }

  if (claim.sharepoint?.syncStatus !== 'failed') {
    const err = new Error('Solo se puede reintentar documentos en estado failed');
    err.code = 'NOT_FAILED';
    err.status = 400;
    throw err;
  }

  claim.sharepoint = claim.sharepoint || {};
  claim.sharepoint.syncStatus = 'failed';
  claim.sharepoint.enabled = true;
  claim.sharepoint.nextRetryAt = new Date();
  claim.markModified('sharepoint');
  await claim.save();

  return {
    claimDocumentId: String(claim._id),
    archivoId: String(archivo._id),
    syncStatus: claim.sharepoint.syncStatus,
    nextRetryAt: claim.sharepoint.nextRetryAt,
    attempts: claim.sharepoint.attempts,
  };
}

export { STATUS_UI };
