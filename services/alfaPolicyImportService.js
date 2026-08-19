/**
 * Importación de pólizas Alfa: SharePoint → S3 → AlfaPolicyDocument.
 *
 * Invariantes (sostenible, sin copias ni fugas entre casos):
 * - 1 archivo SharePoint (itemId) → 1 AlfaPolicyDocument → 1 objeto S3.
 * - N casos se asocian por puntero (association.alfaCaseIds), nunca duplicando S3.
 * - El archivero lista SOLO por alfaCaseIds, nunca por número de póliza.
 * - policyNumber placeholder (POR CONFIRMAR…) no se persiste ni se usa para match.
 * - El cron no debe reimportar archivos que ARNALD ya subió (`SKIP_ARNALD_OUTBOUND` por `sharepoint.itemId`).
 */

import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import ClaimDocument from '../models/ClaimDocument.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { getAlfaPolicyImportConfig } from '../config/alfaPolicyImport.js';
import { isSharePointConfigured, getSharePointConfig } from '../config/sharepoint.js';
import {
  resolveDriveContext,
  getDriveItemByPath,
  listDriveItemChildrenAll,
  downloadDriveItemBuffer,
  SharePointGraphError,
  SharePointAuthError,
} from './microsoftGraphService.js';
import * as s3 from './s3StorageService.js';
import { normalizePolicyNumber } from '../utils/alfaPolicyNumber.js';
import {
  normalizeIdentification,
  identificationMatchRegex,
  isRealPolicyNumber,
  isPlaceholderPolicyNumber,
  inboundFolderMatchesCase,
} from '../utils/alfaIdentification.js';
import {
  ALFA_POLICY_IMPORT_PREFIX,
  ALFA_SINIESTROS_INBOUND_PREFIX,
  ALFA_POLICY_INBOUND_ROOTS,
  assertAlfaPolicyImportPath,
  assertAlfaPolicyImportRoot,
} from '../utils/alfaPolicySharePointPath.js';
import {
  parseAlfaPolizasFolderName,
  mapAlfaSubfolderToDocumentType,
  isRealAlfaPolicyNumber,
} from '../utils/alfaDocumentPath.js';
import { sanitizeStoredFileName } from '../utils/sharepointClaimPath.js';

const CASE_SELECT =
  '_id consecutivo identificacion numeroPoliza numeroCredito siniestro direccionPredio asegurado fechaSiniestro estado';

const SINIESTROS_SKIP_FOLDERS = new Set([
  'PENDIENTES_NUMERO_SINIESTRO',
  'PENDIENTES',
]);

/** Carpeta bajo SINIESTROS que parece identificación (cédula), no estructura operativa. */
export function isIdentificationInboundFolderName(name) {
  const raw = String(name || '').trim();
  if (!raw) return false;
  if (SINIESTROS_SKIP_FOLDERS.has(raw.toUpperCase())) return false;
  const n = normalizeIdentification(raw);
  if (!n) return false;
  // Cédulas / NIT tipicos: solo dígitos, longitud razonable
  return /^\d{5,15}$/.test(n);
}

export function buildAlfaPolicyIntegrationKey(driveId, itemId) {
  return `sharepoint:${driveId}:${itemId}`;
}

/**
 * Si ARNALD ya subió este item a SharePoint, no reimportarlo a S3/archivero inbound.
 * 1 itemId = 1 copia. Evita duplicar liquidador/informe/fotos.
 */
export async function findArnaldOutboundBySharePointItemId(itemId) {
  const id = String(itemId || '').trim();
  if (!id) return null;
  return ClaimDocument.findOne({
    sourceModule: 'alfa',
    status: 'active',
    'sharepoint.itemId': id,
  })
    .select('_id claimId alfaIdentificacion documentType')
    .lean();
}

function buildS3Key(sourceIdentifier, storedName) {
  const cfg = getAlfaPolicyImportConfig();
  const idSeg =
    sanitizeStoredFileName(sourceIdentifier, { maxLen: 120 }) || 'SIN_IDENTIFICACION';
  const name = sanitizeStoredFileName(storedName) || 'poliza.pdf';
  return `${cfg.s3KeyPrefix}/${idSeg}/${name}`;
}

function isPdfItem(item) {
  const name = String(item?.name || '').toLowerCase();
  const mime = String(item?.file?.mimeType || '').toLowerCase();
  if (mime === 'application/pdf') return true;
  if (name.endsWith('.pdf')) return true;
  return false;
}

/** Inbound Alfa: PDF siempre; en subcarpetas tipadas también office/imagen/texto. */
function isImportableAlfaDocumentItem(item, documentType = 'poliza') {
  if (!item || item.folder) return false;
  if (isPdfItem(item)) return true;
  const type = String(documentType || 'poliza').toLowerCase();
  if (type === 'poliza') return false;
  const name = String(item?.name || '').toLowerCase();
  const mime = String(item?.file?.mimeType || '').toLowerCase();
  const allowedExt =
    /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|tif{1,2}|bmp|txt|csv|msg|eml)$/i;
  if (allowedExt.test(name)) return true;
  if (
    mime.startsWith('image/') ||
    mime.startsWith('text/') ||
    mime.includes('officedocument') ||
    mime.includes('msword') ||
    mime.includes('excel')
  ) {
    return true;
  }
  return false;
}

function normText(value) {
  if (value == null || value === '') return '';
  return String(value).trim().replace(/\s+/g, ' ').toUpperCase();
}

function sameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
}

/**
 * Busca casos Alfa cuya identificación normalizada coincide con la carpeta.
 * @param {string} identification
 * @returns {Promise<object[]>}
 */
export async function findAlfaCasesByIdentification(identification) {
  const normalized = normalizeIdentification(identification);
  if (!normalized) return [];

  const rx = identificationMatchRegex(normalized);
  const query = rx
    ? {
        $or: [{ identificacion: normalized }, { identificacion: { $regex: rx } }],
      }
    : { identificacion: normalized };

  const candidates = await SegurosAlfaCaso.find(query).select(CASE_SELECT);
  return candidates.filter((c) => normalizeIdentification(c.identificacion) === normalized);
}

/**
 * @deprecated Preferir findAlfaCasesByIdentification. Conservado para rematch legacy.
 */
export async function findAlfaCasesByPolicyNumber(policyNumber) {
  const normalized = normalizePolicyNumber(policyNumber);
  if (!normalized || !isRealPolicyNumber(normalized)) return [];

  const candidates = await SegurosAlfaCaso.find({
    numeroPoliza: normalized,
  }).select(CASE_SELECT);

  return candidates.filter(
    (c) => normalizePolicyNumber(c.numeroPoliza) === normalized
  );
}

/**
 * Refuerzos no fuzzy sobre candidatos con la misma identificación.
 * @param {object[]} candidates
 * @param {object} [hints]
 */
export function applyAssociationReinforcements(candidates, hints = {}) {
  let pool = [...candidates];
  if (pool.length <= 1) return pool;

  const hintPol = isRealPolicyNumber(hints.numeroPoliza || hints.policyNumber)
    ? normalizePolicyNumber(hints.numeroPoliza || hints.policyNumber)
    : '';
  const hintCred = normText(hints.numeroCredito);
  const hintDir = normText(hints.direccionPredio);
  const hintAseg = normText(hints.asegurado);
  const hintFecha = hints.fechaSiniestro || null;

  if (hintPol) {
    const filtered = pool.filter(
      (c) =>
        isRealPolicyNumber(c.numeroPoliza) &&
        normalizePolicyNumber(c.numeroPoliza) === hintPol
    );
    if (filtered.length > 0) pool = filtered;
  }
  if (pool.length > 1 && hintCred) {
    const filtered = pool.filter((c) => normText(c.numeroCredito) === hintCred);
    if (filtered.length > 0) pool = filtered;
  }
  if (pool.length > 1 && hintFecha) {
    const filtered = pool.filter((c) => sameDay(c.fechaSiniestro, hintFecha));
    if (filtered.length > 0) pool = filtered;
  }
  if (pool.length > 1 && hintDir) {
    const filtered = pool.filter((c) => normText(c.direccionPredio) === hintDir);
    if (filtered.length > 0) pool = filtered;
  }
  if (pool.length > 1 && hintAseg) {
    const filtered = pool.filter((c) => normText(c.asegurado) === hintAseg);
    if (filtered.length > 0) pool = filtered;
  }

  return pool;
}

/**
 * Si varios casos de la misma ID comparten el mismo numeroPoliza real → 1 doc → N casos.
 */
function resolveMultiCaseSamePolicy(candidates) {
  if (!candidates || candidates.length < 2) return null;
  const realPols = candidates
    .map((c) => normalizePolicyNumber(c.numeroPoliza))
    .filter((p) => isRealPolicyNumber(p));
  if (realPols.length !== candidates.length) return null;
  const unique = new Set(realPols);
  if (unique.size !== 1) return null;
  return candidates;
}

function enrichPolicyNumberFromCases(doc, cases) {
  const realPols = [
    ...new Set(
      (cases || [])
        .map((c) => normalizePolicyNumber(c.numeroPoliza))
        .filter((p) => isRealPolicyNumber(p))
    ),
  ];
  if (realPols.length === 1) {
    doc.policyNumber = realPols[0];
    return;
  }
  if (!isRealPolicyNumber(doc.policyNumber) || isPlaceholderPolicyNumber(doc.policyNumber)) {
    doc.policyNumber = null;
  }
}

/**
 * Aplica asociación por identificación (0 / 1 / 2+ con refuerzos).
 * @param {import('mongoose').Document} doc
 * @param {{ hints?: object }} [opts]
 */
export async function associateAlfaPolicyDocument(doc, { hints = {} } = {}) {
  const now = new Date();
  doc.association = doc.association || {};
  doc.association.lastMatchAttemptAt = now;

  const sourceId = normalizeIdentification(doc.sourceIdentifier);
  if (!sourceId || doc.sourceIdentifierType !== 'identificacion') {
    doc.association.status = 'unmatched';
    doc.association.alfaCaseIds = [];
    doc.association.candidateCaseIds = [];
    doc.association.matchedBy = undefined;
    doc.association.matchedAt = undefined;
    await doc.save();
    return {
      status: 'unmatched',
      alfaCaseIds: [],
      candidateCaseIds: [],
      caseCount: 0,
    };
  }

  // Mantener sourceIdentifier normalizado
  doc.sourceIdentifier = sourceId;

  let cases = await findAlfaCasesByIdentification(sourceId);
  let matchedBy = 'identificacion';

  const hintPolRaw = hints.numeroPoliza || hints.policyNumber || doc.policyNumber;
  const hintPol = isRealPolicyNumber(hintPolRaw)
    ? normalizePolicyNumber(hintPolRaw)
    : '';

  // Prioridad: identificación + póliza (carpeta definitiva)
  if (cases.length >= 1 && hintPol) {
    const byPol = cases.filter(
      (c) =>
        isRealPolicyNumber(c.numeroPoliza) &&
        normalizePolicyNumber(c.numeroPoliza) === hintPol
    );
    if (byPol.length === 1) {
      cases = byPol;
      matchedBy = 'identificacion_poliza';
    } else if (byPol.length > 1) {
      cases = byPol;
      matchedBy = 'identificacion';
    } else if (cases.length !== 1) {
      // póliza de carpeta no coincide: seguir con pool completo + refuerzos
    }
  }

  if (cases.length >= 2 && matchedBy !== 'identificacion_poliza') {
    const reinforced = applyAssociationReinforcements(cases, {
      ...hints,
      // Si el doc ya tiene policyNumber real enriquecido, úsalo como señal
      policyNumber: isRealPolicyNumber(doc.policyNumber) ? doc.policyNumber : hints.policyNumber,
      numeroPoliza: hints.numeroPoliza,
    });
    if (reinforced.length === 1) {
      cases = reinforced;
      matchedBy = 'identificacion_refuerzo';
    } else if (reinforced.length >= 2) {
      const multi = resolveMultiCaseSamePolicy(reinforced);
      if (multi) {
        cases = multi;
        matchedBy = 'identificacion_multi';
      } else {
        doc.association.status = 'ambiguous';
        doc.association.alfaCaseIds = [];
        doc.association.candidateCaseIds = reinforced.map((c) => c._id);
        doc.association.matchedBy = undefined;
        doc.association.matchedAt = undefined;
        await doc.save();
        return {
          status: 'ambiguous',
          alfaCaseIds: [],
          candidateCaseIds: reinforced.map((c) => String(c._id)),
          caseCount: reinforced.length,
        };
      }
    } else {
      cases = [];
    }
  }

  if (cases.length === 0) {
    doc.association.status = 'unmatched';
    doc.association.alfaCaseIds = [];
    doc.association.candidateCaseIds = [];
    doc.association.matchedBy = undefined;
    doc.association.matchedAt = undefined;
  } else {
    const sameFolder = cases.filter((c) => inboundFolderMatchesCase(sourceId, c));
    if (sameFolder.length === 0) {
      doc.association.status = 'unmatched';
      doc.association.alfaCaseIds = [];
      doc.association.candidateCaseIds = [];
      doc.association.matchedBy = undefined;
      doc.association.matchedAt = undefined;
    } else {
      doc.association.status = 'matched';
      doc.association.alfaCaseIds = sameFolder.map((c) => c._id);
      doc.association.candidateCaseIds = [];
      doc.association.matchedBy = matchedBy;
      doc.association.matchedAt = now;
      enrichPolicyNumberFromCases(doc, sameFolder);
    }
  }

  await doc.save();
  return {
    status: doc.association.status,
    alfaCaseIds: (doc.association.alfaCaseIds || []).map((id) => String(id)),
    candidateCaseIds: (doc.association.candidateCaseIds || []).map((id) => String(id)),
    caseCount: (doc.association.alfaCaseIds || []).length,
    policyNumber: doc.policyNumber || null,
    matchedBy: doc.association.matchedBy || null,
  };
}

/**
 * Enriquecer policyNumber en docs ya matched cuando el caso recibe póliza real (Excel).
 */
export async function enrichAlfaPolicyDocumentsForCase(caso) {
  if (!caso?._id) return { enriched: 0 };
  const pol = normalizePolicyNumber(caso.numeroPoliza);
  if (!isRealPolicyNumber(pol)) return { enriched: 0 };

  const docs = await AlfaPolicyDocument.find({
    status: 'active',
    'association.alfaCaseIds': caso._id,
    $or: [
      { policyNumber: null },
      { policyNumber: '' },
      { policyNumber: { $exists: false } },
    ],
  });

  let enriched = 0;
  for (const doc of docs) {
    if (!isRealPolicyNumber(pol) || isPlaceholderPolicyNumber(pol)) continue;
    doc.policyNumber = pol;
    await doc.save();
    enriched += 1;
  }
  return { enriched, policyNumber: pol };
}

/**
 * Reintenta asociación de pólizas unmatched/ambiguous sin re-descargar.
 */
export async function matchUnmatchedAlfaPolicies({ limit = 100 } = {}) {
  const docs = await AlfaPolicyDocument.find({
    status: 'active',
    importStatus: 'imported',
    'association.status': { $in: ['unmatched', 'ambiguous'] },
  })
    .sort({ updatedAt: 1 })
    .limit(limit);

  const results = [];
  for (const doc of docs) {
    const association = await associateAlfaPolicyDocument(doc);
    results.push({
      documentId: String(doc._id),
      sourceIdentifier: doc.sourceIdentifier,
      policyNumber: doc.policyNumber || null,
      ...association,
    });
  }
  return {
    reviewed: docs.length,
    newlyMatched: results.filter((r) => r.status === 'matched').length,
    stillUnmatched: results.filter((r) => r.status === 'unmatched').length,
    stillAmbiguous: results.filter((r) => r.status === 'ambiguous').length,
    results,
  };
}

/**
 * Importa un único archivo SharePoint (PDF) de una carpeta de identificación.
 */
export async function importAlfaPolicyFile({
  driveId,
  siteId,
  sourceIdentifier,
  /** @deprecated usar sourceIdentifier */
  policyNumber,
  folderPath,
  item,
  hints,
  documentType = 'poliza',
} = {}) {
  const rawFolderId = sourceIdentifier ?? policyNumber;
  const normalizedId = normalizeIdentification(rawFolderId);
  if (!normalizedId) {
    return { result: 'SKIP_EMPTY_SOURCE_IDENTIFIER' };
  }

  const resolvedType = String(documentType || 'poliza').toLowerCase();

  assertAlfaPolicyImportPath(folderPath);

  if (item?.folder) {
    return { result: 'SKIP_FOLDER' };
  }

  if (!isImportableAlfaDocumentItem(item, resolvedType)) {
    console.log(
      JSON.stringify({
        event: 'Alfa policy import skipped',
        code: 'INVALID_POLICY_FILE_TYPE',
        sourceIdentifier: normalizedId,
        name: item?.name,
        mimeType: item?.file?.mimeType || null,
        documentType: resolvedType,
      })
    );
    return {
      result: 'INVALID_POLICY_FILE_TYPE',
      sourceIdentifier: normalizedId,
      name: item?.name,
    };
  }

  const mergeHints = {
    ...(hints || {}),
  };
  if (isRealAlfaPolicyNumber(mergeHints.numeroPoliza || mergeHints.policyNumber)) {
    // ok
  }

  const itemId = item.id;
  const eTag = item.eTag || null;
  const integrationKey = buildAlfaPolicyIntegrationKey(driveId, itemId);

  const arnaldOutbound = await findArnaldOutboundBySharePointItemId(itemId);
  if (arnaldOutbound) {
    return {
      result: 'SKIP_ARNALD_OUTBOUND',
      claimDocumentId: String(arnaldOutbound._id),
      sourceIdentifier: normalizedId,
      name: item?.name,
    };
  }

  const existing = await AlfaPolicyDocument.findOne({ integrationKey });
  if (existing && existing.status === 'active') {
    const sameEtag =
      eTag && existing.sharepoint?.eTag && existing.sharepoint.eTag === eTag;
    if (sameEtag || (!eTag && existing.storage?.key)) {
      if (resolvedType && existing.documentType !== resolvedType) {
        existing.documentType = resolvedType;
      }
      // Reasocia punteros a casos. No re-descarga ni vuelve a escribir S3.
      const association = await associateAlfaPolicyDocument(existing, {
        hints: mergeHints,
      });
      return {
        result: 'SKIP_ALREADY_IMPORTED',
        documentId: String(existing._id),
        sourceIdentifier: normalizedId,
        policyNumber: existing.policyNumber || null,
        documentType: existing.documentType,
        association,
      };
    }

    return updateAlfaPolicyFromSharePoint({
      doc: existing,
      driveId,
      siteId,
      sourceIdentifier: normalizedId,
      folderPath,
      item,
      hints: mergeHints,
      documentType: resolvedType,
    });
  }

  const storedName = sanitizeStoredFileName(item.name || 'poliza.pdf');
  const s3Key = buildS3Key(normalizedId, storedName);
  const filePath = assertAlfaPolicyImportPath(`${folderPath}/${item.name}`);

  let buffer;
  try {
    const downloaded = await downloadDriveItemBuffer({ driveId, itemId });
    buffer = downloaded.buffer;
  } catch (error) {
    return {
      result: 'ERROR',
      code: error?.code || 'SHAREPOINT_DOWNLOAD_ERROR',
      message: error?.message,
      sourceIdentifier: normalizedId,
      name: item.name,
    };
  }

  let putResult;
  try {
    putResult = await s3.putObject({
      key: s3Key,
      body: buffer,
      contentType: item.file?.mimeType || 'application/pdf',
      contentLength: buffer.length,
      metadata: {
        source: 'sharepoint',
        module: 'alfa',
        sourceIdentifier: normalizedId,
        sourceIdentifierType: 'identificacion',
        sharepointItemId: itemId,
      },
    });
  } catch (error) {
    return {
      result: 'ERROR',
      code: 'S3_UPLOAD_ERROR',
      message: s3.mapS3ErrorMessage(error) || error?.message,
      sourceIdentifier: normalizedId,
      name: item.name,
    };
  }

  let storageEtag = putResult.etag || null;
  if (!storageEtag) {
    try {
      const head = await s3.headObject(s3Key);
      storageEtag = head?.ETag || null;
    } catch {
      /* opcional */
    }
  }

  const lastModified = item.lastModifiedDateTime
    ? new Date(item.lastModifiedDateTime)
    : null;

  let doc;
  try {
    doc = await AlfaPolicyDocument.create({
      integrationKey,
      source: 'sharepoint',
      sourceModule: 'alfa',
      documentType: resolvedType,
      sourceIdentifier: normalizedId,
      sourceIdentifierType: 'identificacion',
      policyNumber: isRealAlfaPolicyNumber(mergeHints.numeroPoliza || mergeHints.policyNumber)
        ? normalizePolicyNumber(mergeHints.numeroPoliza || mergeHints.policyNumber)
        : null,
      originalName: item.name,
      storedName,
      mimeType: item.file?.mimeType || 'application/pdf',
      size: item.size ?? null,
      sharepoint: {
        siteId: siteId || null,
        driveId,
        itemId,
        parentItemId: item.parentReference?.id || null,
        path: filePath,
        webUrl: item.webUrl || null,
        eTag,
        lastModifiedDateTime: lastModified,
      },
      storage: {
        provider: 's3',
        bucket: putResult.bucket,
        key: putResult.key,
        etag: storageEtag,
      },
      association: {
        status: 'unmatched',
        alfaCaseIds: [],
        candidateCaseIds: [],
      },
      importStatus: 'imported',
      importAttempts: 1,
      importedAt: new Date(),
      sourceDeleted: false,
      status: 'active',
    });
  } catch (error) {
    if (error?.code === 11000) {
      const raced = await AlfaPolicyDocument.findOne({ integrationKey });
      if (raced) {
        const association = await associateAlfaPolicyDocument(raced, { hints });
        return {
          result: 'SKIP_ALREADY_IMPORTED',
          documentId: String(raced._id),
          sourceIdentifier: normalizedId,
          policyNumber: raced.policyNumber || null,
          association,
        };
      }
    }
    return {
      result: 'ERROR',
      code: 'MONGO_SAVE_ERROR',
      message: error?.message,
      sourceIdentifier: normalizedId,
      name: item.name,
    };
  }

  const association = await associateAlfaPolicyDocument(doc, { hints: mergeHints });
  return {
    result: 'IMPORTED',
    documentId: String(doc._id),
    sourceIdentifier: normalizedId,
    policyNumber: doc.policyNumber || null,
    documentType: resolvedType,
    s3Key: putResult.key,
    association,
  };
}

async function updateAlfaPolicyFromSharePoint({
  doc,
  driveId,
  siteId,
  sourceIdentifier,
  folderPath,
  item,
  hints,
  documentType,
}) {
  const itemId = item.id;
  const eTag = item.eTag || null;
  const storedName = sanitizeStoredFileName(item.name || doc.storedName || 'poliza.pdf');
  const s3Key = doc.storage?.key || buildS3Key(sourceIdentifier, storedName);
  const filePath = assertAlfaPolicyImportPath(`${folderPath}/${item.name}`);

  let buffer;
  try {
    const downloaded = await downloadDriveItemBuffer({ driveId, itemId });
    buffer = downloaded.buffer;
  } catch (error) {
    doc.importStatus = 'error';
    doc.lastError = {
      code: error?.code || 'SHAREPOINT_DOWNLOAD_ERROR',
      message: error?.message,
    };
    doc.importAttempts = (doc.importAttempts || 0) + 1;
    await doc.save();
    return {
      result: 'ERROR',
      code: doc.lastError.code,
      message: doc.lastError.message,
      documentId: String(doc._id),
    };
  }

  let storageEtag = null;
  try {
    const putResult = await s3.putObject({
      key: s3Key,
      body: buffer,
      contentType: item.file?.mimeType || doc.mimeType || 'application/pdf',
      contentLength: buffer.length,
      metadata: {
        source: 'sharepoint',
        module: 'alfa',
        sourceIdentifier,
        sourceIdentifierType: 'identificacion',
        sharepointItemId: itemId,
        updated: '1',
      },
    });
    storageEtag = putResult.etag || null;
  } catch (error) {
    doc.importStatus = 'error';
    doc.lastError = {
      code: 'S3_UPLOAD_ERROR',
      message: s3.mapS3ErrorMessage(error) || error?.message,
    };
    doc.importAttempts = (doc.importAttempts || 0) + 1;
    await doc.save();
    return {
      result: 'ERROR',
      code: 'S3_UPLOAD_ERROR',
      message: doc.lastError.message,
      documentId: String(doc._id),
    };
  }

  if (!storageEtag) {
    try {
      const head = await s3.headObject(s3Key);
      storageEtag = head?.ETag || null;
    } catch {
      /* opcional */
    }
  }

  const previousEtag = doc.sharepoint?.eTag || null;
  doc.sourceIdentifier = sourceIdentifier;
  doc.sourceIdentifierType = 'identificacion';
  if (documentType) doc.documentType = documentType;
  doc.sharepoint = {
    ...(doc.sharepoint?.toObject?.() || doc.sharepoint || {}),
    siteId: siteId || doc.sharepoint?.siteId,
    driveId,
    itemId,
    parentItemId: item.parentReference?.id || doc.sharepoint?.parentItemId,
    path: filePath,
    webUrl: item.webUrl || doc.sharepoint?.webUrl,
    previousEtag,
    eTag,
    lastModifiedDateTime: item.lastModifiedDateTime
      ? new Date(item.lastModifiedDateTime)
      : doc.sharepoint?.lastModifiedDateTime,
    lastVersionAt: new Date(),
  };
  doc.originalName = item.name || doc.originalName;
  doc.storedName = storedName;
  doc.mimeType = item.file?.mimeType || doc.mimeType;
  doc.size = item.size ?? doc.size;
  doc.storage = {
    provider: 's3',
    bucket: s3.getBucketName(),
    key: s3Key,
    etag: storageEtag,
  };
  doc.importStatus = 'imported';
  doc.lastError = undefined;
  doc.importAttempts = (doc.importAttempts || 0) + 1;
  doc.sourceDeleted = false;
  await doc.save();

  const association = await associateAlfaPolicyDocument(doc, { hints });
  return {
    result: 'SOURCE_UPDATED',
    documentId: String(doc._id),
    sourceIdentifier,
    policyNumber: doc.policyNumber || null,
    s3Key,
    previousEtag,
    eTag,
    association,
  };
}

/**
 * Lista carpetas de identificación bajo PÓLIZAS y SINIESTROS y procesa PDFs.
 * Raíces vacías → NO_POLICY_FOLDERS_FOUND (no es error).
 */
export async function runAlfaPolicyImportCycle({ batchSize } = {}) {
  const cfg = getAlfaPolicyImportConfig();
  const size = batchSize ?? cfg.batchSize;
  const started = Date.now();

  const summary = {
    code: null,
    listedFolders: 0,
    processedFiles: 0,
    imported: 0,
    skippedAlready: 0,
    skippedArnaldOutbound: 0,
    updated: 0,
    unmatched: 0,
    matched: 0,
    ambiguous: 0,
    invalidType: 0,
    errors: 0,
    rematch: null,
    roots: [],
    durationMs: 0,
    outcomes: [],
  };

  if (!isSharePointConfigured()) {
    summary.error = 'SHAREPOINT_NOT_CONFIGURED';
    summary.durationMs = Date.now() - started;
    return summary;
  }

  let driveId;
  let siteId;
  try {
    const ctx = await resolveDriveContext();
    driveId = ctx.driveId;
    siteId = ctx.siteId;
  } catch (error) {
    summary.error = error?.code || 'SHAREPOINT_ROOT_ERROR';
    summary.errorMessage = error?.message;
    summary.durationMs = Date.now() - started;
    return summary;
  }

  // Primario: config.rootPath (PÓLIZAS). Secundario: SINIESTROS (realidad Alfa).
  const rootsToScan = [];
  try {
    rootsToScan.push(assertAlfaPolicyImportRoot(cfg.rootPath));
  } catch (error) {
    summary.error = error?.code || 'INVALID_POLICY_IMPORT_ROOT';
    summary.errorMessage = error?.message;
    summary.durationMs = Date.now() - started;
    return summary;
  }
  if (!rootsToScan.includes(ALFA_SINIESTROS_INBOUND_PREFIX)) {
    rootsToScan.push(ALFA_SINIESTROS_INBOUND_PREFIX);
  }

  /** @type {{ rootPath: string, folder: object }[]} */
  const idFolders = [];

  for (const rootPath of rootsToScan) {
    let rootItem;
    try {
      rootItem = await getDriveItemByPath(driveId, rootPath);
    } catch (error) {
      summary.roots.push({
        rootPath,
        error: error?.code || 'SHAREPOINT_ROOT_ERROR',
        message: error?.message,
      });
      continue;
    }

    let children = [];
    try {
      children = await listDriveItemChildrenAll({
        driveId,
        itemId: rootItem.id,
      });
    } catch (error) {
      summary.roots.push({
        rootPath,
        error: error?.code || 'SHAREPOINT_LIST_ERROR',
        message: error?.message,
      });
      continue;
    }

    const folders = children.filter((c) => c.folder);
    const accepted =
      rootPath === ALFA_SINIESTROS_INBOUND_PREFIX
        ? folders.filter((f) => isIdentificationInboundFolderName(f.name))
        : folders.filter((f) => {
            const parsed = parseAlfaPolizasFolderName(f.name);
            return parsed.ok;
          });

    summary.roots.push({
      rootPath,
      listedFolders: folders.length,
      identificationFolders: accepted.length,
    });

    for (const folder of accepted) {
      idFolders.push({ rootPath, folder });
    }
  }

  summary.listedFolders = idFolders.length;

  if (idFolders.length === 0) {
    summary.code = 'NO_POLICY_FOLDERS_FOUND';
    summary.durationMs = Date.now() - started;
    console.log(
      JSON.stringify({
        event: 'Alfa policy import cycle finished',
        code: summary.code,
        listedFolders: 0,
        roots: summary.roots,
        durationMs: summary.durationMs,
      })
    );
    return summary;
  }

  const batch = idFolders.slice(0, size);

  async function importOneFile({
    sourceIdentifier,
    folderPath,
    item,
    hints,
    documentType,
  }) {
    const outcome = await importAlfaPolicyFile({
      driveId,
      siteId,
      sourceIdentifier,
      folderPath,
      item,
      hints,
      documentType,
    });
    summary.processedFiles += 1;
    summary.outcomes.push(outcome);
    if (outcome.result === 'IMPORTED') summary.imported += 1;
    else if (outcome.result === 'SKIP_ALREADY_IMPORTED') summary.skippedAlready += 1;
    else if (outcome.result === 'SKIP_ARNALD_OUTBOUND') summary.skippedArnaldOutbound += 1;
    else if (outcome.result === 'SOURCE_UPDATED') summary.updated += 1;
    else if (outcome.result === 'INVALID_POLICY_FILE_TYPE') summary.invalidType += 1;
    else if (outcome.result === 'ERROR') summary.errors += 1;
    if (outcome.association?.status === 'matched') summary.matched += 1;
    if (outcome.association?.status === 'unmatched') summary.unmatched += 1;
    if (outcome.association?.status === 'ambiguous') summary.ambiguous += 1;
  }

  for (const { rootPath, folder } of batch) {
    const parsed =
      rootPath === ALFA_SINIESTROS_INBOUND_PREFIX
        ? {
            ok: true,
            sourceIdentifier: normalizeIdentification(folder.name),
            numeroPoliza: null,
            form: 'provisional',
          }
        : parseAlfaPolizasFolderName(folder.name);

    const sourceIdentifier = parsed.sourceIdentifier || normalizeIdentification(folder.name);
    if (!sourceIdentifier) continue;

    const hints = {};
    if (parsed.numeroPoliza && isRealAlfaPolicyNumber(parsed.numeroPoliza)) {
      hints.numeroPoliza = parsed.numeroPoliza;
      hints.policyNumber = parsed.numeroPoliza;
    }

    let folderPath;
    try {
      folderPath = assertAlfaPolicyImportPath(`${rootPath}/${folder.name}`);
    } catch (error) {
      summary.errors += 1;
      summary.outcomes.push({
        result: 'INVALID_POLICY_IMPORT_PATH',
        name: folder.name,
        message: error.message,
      });
      continue;
    }

    let children = [];
    try {
      children = await listDriveItemChildrenAll({
        driveId,
        itemId: folder.id,
      });
    } catch (error) {
      summary.errors += 1;
      summary.outcomes.push({
        result: 'ERROR',
        code: error?.code || 'SHAREPOINT_LIST_ERROR',
        sourceIdentifier,
        message: error?.message,
      });
      continue;
    }

    for (const item of children) {
      if (item.folder) {
        const subType = mapAlfaSubfolderToDocumentType(item.name);
        if (!subType) continue;
        let subFiles = [];
        try {
          subFiles = await listDriveItemChildrenAll({
            driveId,
            itemId: item.id,
          });
        } catch (error) {
          summary.errors += 1;
          summary.outcomes.push({
            result: 'ERROR',
            code: error?.code || 'SHAREPOINT_LIST_ERROR',
            sourceIdentifier,
            subfolder: item.name,
            message: error?.message,
          });
          continue;
        }
        const subPath = assertAlfaPolicyImportPath(`${folderPath}/${item.name}`);
        for (const file of subFiles) {
          if (file.folder) continue;
          await importOneFile({
            sourceIdentifier,
            folderPath: subPath,
            item: file,
            hints,
            documentType: subType,
          });
        }
        continue;
      }

      // PDF suelto en raíz de la carpeta ID (compat provisional)
      await importOneFile({
        sourceIdentifier,
        folderPath,
        item,
        hints,
        documentType: 'poliza',
      });
    }
  }

  try {
    summary.rematch = await matchUnmatchedAlfaPolicies({ limit: size });
  } catch (error) {
    summary.rematchError = error?.message;
  }

  summary.durationMs = Date.now() - started;
  console.log(
    JSON.stringify({
      event: 'Alfa policy import cycle finished',
      code: summary.code,
      listedFolders: summary.listedFolders,
      processedFiles: summary.processedFiles,
      imported: summary.imported,
      skippedAlready: summary.skippedAlready,
      skippedArnaldOutbound: summary.skippedArnaldOutbound,
      updated: summary.updated,
      matched: summary.matched,
      unmatched: summary.unmatched,
      ambiguous: summary.ambiguous,
      errors: summary.errors,
      roots: summary.roots,
      durationMs: summary.durationMs,
    })
  );

  return summary;
}

/**
 * Lista pólizas/documentos importados asociados a un caso.
 * DTO listo para Archivero (origin=sharepoint).
 *
 * Candado para TODA carpeta SharePoint {cedula}:
 * 1) el caso está en association.alfaCaseIds
 * 2) sourceIdentifier === identificación del caso
 * Nunca por número de póliza.
 */
export async function listImportedAlfaPoliciesForCase(caso) {
  const caseId = caso?._id;
  const idNorm = normalizeIdentification(caso?.identificacion);
  if (!caseId || !idNorm) {
    return [];
  }

  const docs = await AlfaPolicyDocument.find({
    status: 'active',
    importStatus: { $in: ['imported', 'error'] },
    sourceIdentifier: idNorm,
    sourceIdentifierType: 'identificacion',
    'association.alfaCaseIds': caseId,
  })
    .sort({ importedAt: -1, createdAt: -1 })
    .lean();

  const filtered = docs.filter(
    (d) =>
      inboundFolderMatchesCase(d.sourceIdentifier, caso) &&
      (d.association?.alfaCaseIds || []).some((id) => String(id) === String(caseId))
  );

  const out = [];
  for (const d of filtered) {
    let downloadUrl = null;
    if (d.storage?.key) {
      try {
        downloadUrl = await s3.getSignedDownloadUrl(d.storage.key);
      } catch {
        downloadUrl = null;
      }
    }

    out.push({
      id: String(d._id),
      origin: 'sharepoint',
      documentType: d.documentType || 'poliza',
      tipo: 'Póliza',
      originalName: d.originalName,
      mimeType: d.mimeType,
      size: d.size ?? null,
      sourceIdentifier: d.sourceIdentifier || null,
      sourceIdentifierType: d.sourceIdentifierType || null,
      policyNumber: d.policyNumber || null,
      associatedBy:
        d.association?.matchedBy?.startsWith('identificacion') ||
        d.sourceIdentifierType === 'identificacion'
          ? 'identificacion'
          : null,
      associatedByLabel:
        d.sourceIdentifierType === 'identificacion'
          ? 'Asociada por identificación'
          : null,
      storage: {
        provider: d.storage?.provider || 's3',
        bucket: d.storage?.bucket,
        key: d.storage?.key,
      },
      downloadUrl,
      sharepoint: {
        webUrl: d.sharepoint?.webUrl || null,
        path: d.sharepoint?.path || null,
        sourceDeleted: Boolean(d.sourceDeleted),
        eTag: d.sharepoint?.eTag || null,
      },
      association: {
        status: d.association?.status || 'unmatched',
        alfaCaseIds: (d.association?.alfaCaseIds || []).map((id) => String(id)),
        candidateCaseIds: (d.association?.candidateCaseIds || []).map((id) =>
          String(id)
        ),
        matchedBy: d.association?.matchedBy || null,
        matchedAt: d.association?.matchedAt || null,
      },
      importedAt: d.importedAt || d.createdAt || null,
      importStatus: d.importStatus,
    });
  }

  return out;
}

export {
  assertAlfaPolicyImportPath,
  ALFA_POLICY_IMPORT_PREFIX,
  ALFA_SINIESTROS_INBOUND_PREFIX,
  ALFA_POLICY_INBOUND_ROOTS,
  SharePointGraphError,
  SharePointAuthError,
  getSharePointConfig,
  normalizeIdentification,
};
