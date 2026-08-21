/**
 * Encola ClaimDocument tras upload Seguros Alfa (S3 OK + caso guardado).
 * Destino SharePoint: SEGUROS ALFA/SINIESTROS/{CEDULA}/{SUBCARPETA}
 * Si Alfa ya creó la carpeta de cédula, ensureFolder la reutiliza (no duplica).
 * Sin identificación → pending_destination. La póliza placeholder no bloquea.
 */

import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { getSharePointSyncConfig } from '../config/sharepointSync.js';
import { mapAlfaDocumentType } from '../config/alfaClaimDocumentMap.js';
import { sanitizeStoredFileName } from '../utils/sharepointClaimPath.js';
import { parseS3KeyFromStoredPath } from '../utils/storageKeyBuilder.js';
import {
  buildAlfaSiniestrosDocumentPath,
  isRealAlfaPolicyNumber,
} from '../utils/alfaDocumentPath.js';
import { normalizeIdentification as normId } from '../utils/alfaIdentification.js';
import { normalizePolicyNumber } from '../utils/alfaPolicyNumber.js';
import { getBucketName } from './s3StorageService.js';

const ALFA_INSURER = 'SEGUROS ALFA';

export function buildAlfaIntegrationKey(claimId, s3Key) {
  return `alfa:${String(claimId)}:${String(s3Key)}`;
}

/**
 * claimNumber en ClaimDocument = consecutivo (estable) o siniestro si existe.
 * La ruta SharePoint ya no depende de esto.
 */
export function resolveAlfaClaimNumber(caso = {}) {
  const siniestro = String(caso.siniestro || '').trim();
  if (siniestro) {
    return { claimNumber: siniestro, claimNumberSource: 'siniestro' };
  }
  const consecutivo = String(caso.consecutivo || '').trim();
  if (consecutivo) {
    return { claimNumber: consecutivo, claimNumberSource: 'consecutivo' };
  }
  const id = normId(caso.identificacion);
  if (id) {
    return { claimNumber: id, claimNumberSource: 'identificacion_poliza' };
  }
  return null;
}

function logSkip(reason, payload = {}) {
  console.warn(
    JSON.stringify({
      event: 'ALFA_SHAREPOINT_SKIP',
      reason,
      claimId: payload.claimId ? String(payload.claimId) : undefined,
      s3Key: payload.s3Key,
      userId: payload.userId,
      etiqueta: payload.etiqueta,
    })
  );
}

function logEnqueueFailed(payload = {}) {
  console.error(
    JSON.stringify({
      event: 'ALFA_SHAREPOINT_ENQUEUE_FAILED',
      claimId: payload.claimId ? String(payload.claimId) : undefined,
      s3Key: payload.s3Key,
      userId: payload.userId,
      errorCode: payload.errorCode,
      message: String(payload.message || '').slice(0, 500),
    })
  );
}

/**
 * Reactiva documentos PENDING_DESTINATION cuando el caso obtiene cédula.
 * No re-sube a S3.
 */
export async function releaseAlfaPendingDestinationDocuments(caso) {
  if (!caso?._id) return { released: 0 };
  const id = normId(caso.identificacion);
  const pol = normalizePolicyNumber(caso.numeroPoliza);
  if (!id) {
    return { released: 0, reason: 'STILL_NO_IDENTIFICATION' };
  }

  const built = buildAlfaSiniestrosDocumentPath({
    identificacion: id,
    documentType: 'general',
  });
  if (!built.ok) return { released: 0, reason: built.reason };

  const docs = await ClaimDocument.find({
    sourceModule: 'alfa',
    claimId: caso._id,
    status: 'active',
    destinationStatus: 'pending_destination',
  });

  let released = 0;
  for (const doc of docs) {
    doc.destinationStatus = 'ready';
    doc.destinationReason = undefined;
    doc.alfaIdentificacion = id;
    doc.alfaNumeroPoliza = isRealAlfaPolicyNumber(pol) ? pol : undefined;
    doc.claimNumberSource = 'identificacion_poliza';
    if (doc.sharepoint?.syncStatus === 'disabled' || !doc.sharepoint?.itemId) {
      doc.sharepoint = doc.sharepoint || {};
      doc.sharepoint.enabled = true;
      doc.sharepoint.syncStatus = 'pending';
      doc.sharepoint.nextRetryAt = new Date();
      doc.sharepoint.lastError = undefined;
    }
    await doc.save();
    released += 1;
  }

  if (released > 0) {
    console.log(
      JSON.stringify({
        event: 'ALFA_PENDING_DESTINATION_RELEASED',
        claimId: String(caso._id),
        released,
        identificacion: id,
        numeroPoliza: pol,
      })
    );
  }

  return { released, identificacion: id, numeroPoliza: pol };
}

/**
 * @deprecated La carpeta ya no depende del siniestro. Conservado como no-op documentado.
 */
export async function migrateAlfaSharePointFolderWhenSiniestroAssigned(_claimId) {
  return {
    ok: true,
    result: 'NOOP_PATH_INDEPENDENT_OF_SINIESTRO',
    message:
      'El path Alfa outbound usa SEGUROS ALFA/SINIESTROS/{cedula}; el siniestro no renombra carpetas.',
  };
}

/**
 * Tras save exitoso del caso Alfa con archivo nuevo.
 */
export async function enqueueAlfaClaimDocumentAfterUpload({
  caso,
  archivo,
  req,
  etiqueta,
} = {}) {
  try {
    const cfg = getSharePointSyncConfig();
    // Pausado: igual se crea ClaimDocument pendiente para reanudar luego.
    // El worker no escribe a SharePoint mientras alfaEnabled=false.
    const syncPaused = !cfg.alfaEnabled;

    if (!caso?._id) {
      logSkip('MISSING_CASE', {});
      return { ok: false, result: 'MISSING_CASE' };
    }

    const resolved = resolveAlfaClaimNumber(caso);
    if (!resolved) {
      logSkip('MISSING_CLAIM_NUMBER', {
        claimId: caso._id,
        userId: req?.usuario?.id || req?.user?.id,
      });
      return { ok: false, result: 'MISSING_CLAIM_NUMBER' };
    }
    const { claimNumber, claimNumberSource } = resolved;

    const s3Key =
      req?.fileStorage?.s3Key ||
      parseS3KeyFromStoredPath(archivo?.ruta || req?.fileStorage?.publicPath);

    if (!s3Key) {
      logSkip('MISSING_S3_KEY', {
        claimId: caso._id,
        userId: req?.usuario?.id || req?.user?.id,
      });
      return { ok: false, result: 'MISSING_S3_KEY' };
    }

    const bucket = getBucketName();
    if (!bucket) {
      logSkip('MISSING_BUCKET', { claimId: caso._id, s3Key });
      return { ok: false, result: 'MISSING_BUCKET' };
    }

    const mapped = mapAlfaDocumentType(etiqueta || archivo?.etiqueta);
    const integrationKey = buildAlfaIntegrationKey(caso._id, s3Key);

    const identificacion = normId(caso.identificacion);
    const numeroPoliza = normalizePolicyNumber(caso.numeroPoliza);
    const pathBuild = buildAlfaSiniestrosDocumentPath({
      identificacion,
      documentType: mapped.documentType,
    });

    const pendingDestination = !pathBuild.ok;
    const destinationStatus = pendingDestination ? 'pending_destination' : 'ready';
    const destinationReason = pendingDestination
      ? pathBuild.reason || 'MISSING_IDENTIFICATION'
      : undefined;

    const user = req?.usuario || req?.user || {};
    const uploadedByRaw = user.id || user._id;
    const uploadedBy =
      uploadedByRaw && mongoose.Types.ObjectId.isValid(String(uploadedByRaw))
        ? uploadedByRaw
        : undefined;

    const originalName =
      archivo?.nombreOriginal || req?.file?.originalname || 'documento';
    const storedName = sanitizeStoredFileName(originalName);

    const setOnInsert = {
      sourceModule: 'alfa',
      claimId: caso._id,
      claimNumber,
      claimNumberSource: pendingDestination
        ? claimNumberSource
        : 'identificacion_poliza',
      insurer: ALFA_INSURER,
      documentType: mapped.documentType,
      originalName,
      storedName,
      mimeType: archivo?.tipoMime || req?.file?.mimetype,
      size: archivo?.tamaño ?? req?.fileStorage?.size ?? req?.file?.size,
      storage: {
        provider: 's3',
        bucket,
        key: s3Key,
      },
      sharepoint: {
        enabled: true,
        syncStatus: pendingDestination ? 'pending' : 'pending',
        attempts: 0,
      },
      destinationStatus,
      destinationReason,
      alfaIdentificacion: identificacion || undefined,
      alfaNumeroPoliza: isRealAlfaPolicyNumber(numeroPoliza)
        ? numeroPoliza
        : undefined,
      uploadedBy,
      uploadedByLogin: archivo?.subidoPor?.login || user.login || user.email,
      uploadedByName: archivo?.subidoPor?.nombre || user.nombre || user.name,
      status: 'active',
      integrationKey,
    };

    let doc;
    let upserted = false;
    try {
      const raw = await ClaimDocument.findOneAndUpdate(
        { integrationKey },
        { $setOnInsert: setOnInsert },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
          includeResultMetadata: true,
        }
      );
      doc = raw?.value ?? raw;
      const updatedExisting = raw?.lastErrorObject?.updatedExisting;
      upserted = updatedExisting === false;
      if (updatedExisting === undefined && doc) {
        upserted = Date.now() - new Date(doc.createdAt).getTime() < 3000;
      }
    } catch (error) {
      if (error?.code === 11000) {
        doc = await ClaimDocument.findOne({ integrationKey });
        return { ok: true, result: 'DUPLICATE', document: doc };
      }
      throw error;
    }

    if (!upserted && doc) {
      return { ok: true, result: 'DUPLICATE', document: doc };
    }

    console.log(
      JSON.stringify({
        event: syncPaused
          ? 'ALFA_SHAREPOINT_ENQUEUED_PAUSED'
          : pendingDestination
            ? 'ALFA_SHAREPOINT_ENQUEUED_PENDING_DESTINATION'
            : 'ALFA_SHAREPOINT_ENQUEUED',
        claimId: String(caso._id),
        documentId: String(doc._id),
        claimNumber,
        documentType: mapped.documentType,
        destinationStatus,
        destinationReason,
        proposedPath: pathBuild.path || null,
        integrationKey,
        s3Key,
        syncPaused,
        alfaEnabled: cfg.alfaEnabled,
      })
    );

    return {
      ok: true,
      result: syncPaused
        ? 'ENQUEUED_PAUSED'
        : pendingDestination
          ? 'PENDING_DESTINATION'
          : 'ENQUEUED',
      document: doc,
    };
  } catch (error) {
    logEnqueueFailed({
      claimId: caso?._id,
      s3Key: req?.fileStorage?.s3Key,
      userId: req?.usuario?.id || req?.user?.id,
      errorCode: error?.code || 'ENQUEUE_ERROR',
      message: error?.message,
    });
    return { ok: false, result: 'ENQUEUE_FAILED', error };
  }
}

function fileExt(name = '') {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

/**
 * Tras reemplazar un archivo generado (liquidador/informe): actualiza el
 * ClaimDocument existente y lo reencola a SharePoint (conflict=replace).
 * Si no hay Claim previo, cae a enqueue normal.
 */
export async function enqueueAlfaClaimDocumentAfterReplace({
  caso,
  archivo,
  previousRuta,
  req,
  etiqueta,
} = {}) {
  try {
    const mapped = mapAlfaDocumentType(etiqueta || archivo?.etiqueta);
    const newS3Key =
      req?.fileStorage?.s3Key ||
      parseS3KeyFromStoredPath(archivo?.ruta || req?.fileStorage?.publicPath);
    const oldS3Key = parseS3KeyFromStoredPath(previousRuta);

    if (!caso?._id || !newS3Key) {
      return enqueueAlfaClaimDocumentAfterUpload({ caso, archivo, req, etiqueta });
    }

    const ext = fileExt(archivo?.nombreOriginal || req?.file?.originalname);
    let claim = null;

    if (oldS3Key) {
      claim = await ClaimDocument.findOne({
        sourceModule: 'alfa',
        claimId: caso._id,
        status: 'active',
        'storage.key': oldS3Key,
      });
    }

    if (!claim) {
      const q = {
        sourceModule: 'alfa',
        claimId: caso._id,
        status: 'active',
        documentType: mapped.documentType,
      };
      const candidates = await ClaimDocument.find(q).sort({ updatedAt: -1 }).limit(20);
      claim =
        candidates.find((c) => !ext || fileExt(c.originalName) === ext) ||
        candidates[0] ||
        null;
    }

    if (!claim) {
      return enqueueAlfaClaimDocumentAfterUpload({ caso, archivo, req, etiqueta });
    }

    const cfg = getSharePointSyncConfig();
    const resolved = resolveAlfaClaimNumber(caso);
    const bucket = getBucketName();
    const identificacion = normId(caso.identificacion);
    const pathBuild = buildAlfaSiniestrosDocumentPath({
      identificacion,
      documentType: mapped.documentType,
    });
    const pendingDestination = !pathBuild.ok;

    const originalName =
      archivo?.nombreOriginal || req?.file?.originalname || claim.originalName;
    // Nombre estable en SharePoint (sobrescribe); el key S3 puede cambiar
    const storedName = sanitizeStoredFileName(originalName);

    claim.claimNumber = resolved?.claimNumber || claim.claimNumber;
    claim.claimNumberSource = resolved?.claimNumberSource || claim.claimNumberSource;
    claim.documentType = mapped.documentType;
    claim.originalName = originalName;
    claim.storedName = storedName;
    claim.mimeType = archivo?.tipoMime || req?.file?.mimetype || claim.mimeType;
    claim.size = archivo?.tamaño ?? req?.fileStorage?.size ?? req?.file?.size ?? claim.size;
    claim.storage = {
      provider: 's3',
      bucket: bucket || claim.storage?.bucket,
      key: newS3Key,
    };
    claim.integrationKey = buildAlfaIntegrationKey(caso._id, newS3Key);
    claim.destinationStatus = pendingDestination ? 'pending_destination' : 'ready';
    claim.destinationReason = pendingDestination
      ? pathBuild.reason || 'MISSING_IDENTIFICATION'
      : undefined;
    claim.alfaIdentificacion = identificacion || claim.alfaIdentificacion;
    claim.sharepoint = claim.sharepoint || {};
    claim.sharepoint.enabled = claim.sharepoint.enabled !== false;
    claim.sharepoint.syncStatus = 'pending';
    claim.sharepoint.attempts = 0;
    claim.sharepoint.nextRetryAt = new Date();
    claim.sharepoint.lastError = undefined;
    // Forzar re-subida con conflict=replace sobre el mismo nombre estable
    claim.sharepoint.itemId = undefined;
    claim.sharepoint.path = undefined;
    claim.sharepoint.webUrl = undefined;
    claim.sharepoint.syncedAt = undefined;
    claim.markModified('sharepoint');
    claim.markModified('storage');
    await claim.save();

    // Archivar ClaimDocuments duplicados del mismo tipo+ext (copias viejas)
    if (ext) {
      const dupes = await ClaimDocument.find({
        sourceModule: 'alfa',
        claimId: caso._id,
        status: 'active',
        documentType: mapped.documentType,
        _id: { $ne: claim._id },
      });
      for (const d of dupes) {
        if (fileExt(d.originalName) !== ext) continue;
        d.status = 'archived';
        d.sharepoint = d.sharepoint || {};
        d.sharepoint.enabled = false;
        d.sharepoint.syncStatus = 'disabled';
        d.markModified('sharepoint');
        await d.save();
      }
    }

    console.log(
      JSON.stringify({
        event: cfg.alfaEnabled
          ? 'ALFA_SHAREPOINT_REENQUEUED_REPLACE'
          : 'ALFA_SHAREPOINT_REENQUEUED_REPLACE_PAUSED',
        claimId: String(caso._id),
        documentId: String(claim._id),
        documentType: mapped.documentType,
        oldS3Key: oldS3Key || null,
        newS3Key,
        originalName,
      })
    );

    return { ok: true, result: 'REPLACED_REENQUEUED', document: claim };
  } catch (error) {
    logEnqueueFailed({
      claimId: caso?._id,
      s3Key: req?.fileStorage?.s3Key,
      userId: req?.usuario?.id || req?.user?.id,
      errorCode: error?.code || 'REPLACE_ENQUEUE_ERROR',
      message: error?.message,
    });
    return { ok: false, result: 'ENQUEUE_FAILED', error };
  }
}

/**
 * Tras update de caso (Excel / formulario): liberar pending destination.
 */
export async function onAlfaCasePolicyMaybeReady(casoId) {
  if (!casoId) return { released: 0 };
  const caso = await SegurosAlfaCaso.findById(casoId);
  if (!caso) return { released: 0 };
  return releaseAlfaPendingDestinationDocuments(caso);
}

export { ALFA_INSURER, buildAlfaSiniestrosDocumentPath };
