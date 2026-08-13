/**
 * Sincronización ARNALD: AWS S3 (fuente de verdad) → SharePoint (réplica).
 *
 * No autentica Graph (usa microsoftGraphService).
 * No altera el objeto original en S3.
 * No escribe metadatos en Mongo (Fase 4+).
 */

import { createHash } from 'crypto';
import { Readable, Transform } from 'stream';
import * as s3 from './s3StorageService.js';
import {
  ensureFolder,
  uploadFileFromStream,
  getItemMetadata,
  getItemContentStream,
  SharePointAuthError,
  SharePointGraphError,
  GRAPH_SIMPLE_UPLOAD_MAX_BYTES,
} from './microsoftGraphService.js';
import { assertAllowedSharePointPath } from '../utils/sharepointPathGuard.js';
import { getSharePointSyncConfig } from '../config/sharepointSync.js';

export class SyncError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.cause = cause;
  }
}

function toNodeReadable(body) {
  if (!body) return null;
  if (body instanceof Readable) return body;
  if (typeof body.transformToWebStream === 'function') {
    return Readable.fromWeb(body.transformToWebStream());
  }
  if (typeof body.getReader === 'function') {
    return Readable.fromWeb(body);
  }
  if (Symbol.asyncIterator in Object(body)) {
    return Readable.from(body);
  }
  return body;
}

function createHashTransform() {
  const hash = createHash('sha256');
  const transform = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  return {
    transform,
    digest: () => hash.digest('hex'),
  };
}

async function hashReadable(stream) {
  const hash = createHash('sha256');
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/**
 * Copia un objeto S3 a una ruta SharePoint.
 * Valida destino con assertAllowedSharePointPath (test/pilot/alfa).
 */
export async function syncS3ObjectToSharePoint({
  bucket,
  key,
  destinationPath,
  destinationFileName,
  mimeType,
  size,
  conflictBehavior = 'replace',
  verifyHash = true,
  sourceModule,
} = {}) {
  if (!key) {
    throw new SyncError('S3_OBJECT_NOT_FOUND', 'Falta key de S3');
  }

  const cfg = getSharePointSyncConfig();
  let destFolder;
  try {
    destFolder = assertAllowedSharePointPath({
      path: destinationPath,
      sourceModule,
      mode: cfg.mode,
    });
  } catch (error) {
    throw new SyncError(
      error?.code || 'INVALID_SHAREPOINT_PATH',
      error.message || 'Ruta SharePoint no autorizada',
      error
    );
  }

  const fileName = String(destinationFileName || key.split('/').pop() || 'file.bin').replace(
    /^\/+|\/+$/g,
    ''
  );
  if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
    throw new SyncError('INVALID_SHAREPOINT_PATH', 'destinationFileName inválido');
  }
  try {
    assertAllowedSharePointPath({
      path: `${destFolder}/${fileName}`,
      sourceModule,
      mode: cfg.mode,
    });
  } catch (error) {
    throw new SyncError(
      error?.code || 'INVALID_SHAREPOINT_PATH',
      error.message || 'Ruta SharePoint no autorizada',
      error
    );
  }

  const Bucket = bucket || s3.getBucketName();

  let head;
  try {
    head = await s3.headObject(key, { bucket: Bucket });
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const missing =
      error?.name === 'NotFound' ||
      error?.name === 'NoSuchKey' ||
      status === 404;
    if (missing) {
      throw new SyncError(
        'S3_OBJECT_NOT_FOUND',
        `Objeto S3 no encontrado: s3://${Bucket}/${key}`,
        error
      );
    }
    throw new SyncError('S3_HEAD_ERROR', error.message || 'Error HeadObject S3', error);
  }

  const contentType = mimeType || head.ContentType || 'application/octet-stream';
  const objectSize =
    size != null ? Number(size) : head.ContentLength != null ? Number(head.ContentLength) : null;

  let getResp;
  try {
    getResp = await s3.getObjectStream(key, { bucket: Bucket });
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (error?.name === 'NoSuchKey' || status === 404) {
      throw new SyncError(
        'S3_OBJECT_NOT_FOUND',
        `Objeto S3 no encontrado al streamear: s3://${Bucket}/${key}`,
        error
      );
    }
    throw new SyncError('S3_GET_ERROR', error.message || 'Error GetObject S3', error);
  }

  const bodyStream = toNodeReadable(getResp.Body);
  if (!bodyStream) {
    throw new SyncError('S3_GET_ERROR', 'GetObject sin Body/stream');
  }

  const { transform: hashTransform, digest: sourceDigest } = createHashTransform();
  const hashedStream = bodyStream.pipe(hashTransform);

  let folderResult;
  try {
    folderResult = await ensureFolder(destFolder);
  } catch (error) {
    rethrowGraphAsSync(error);
  }

  let uploadResult;
  try {
    uploadResult = await uploadFileFromStream({
      folderPath: destFolder,
      fileName,
      stream: hashedStream,
      size: objectSize,
      contentType,
      conflictBehavior,
    });
  } catch (error) {
    rethrowGraphAsSync(error);
  }

  const sourceHash = sourceDigest();
  let meta;
  try {
    meta = await getItemMetadata(uploadResult.item.id);
  } catch (error) {
    rethrowGraphAsSync(error);
  }

  let destinationHash = null;
  let hashMatch = null;
  let hashNote;
  if (verifyHash) {
    try {
      const contentStream = await getItemContentStream(meta.id);
      destinationHash = await hashReadable(contentStream);
      hashMatch = sourceHash === destinationHash;
    } catch (error) {
      destinationHash = null;
      hashMatch = null;
      hashNote = `Hash destino no verificado: ${error.message}. Se validó name/size.`;
    }
  }

  const sizeMatch = objectSize == null || Number(meta.size) === Number(objectSize);

  return {
    ok: true,
    strategy: uploadResult.strategy,
    simpleUploadMaxBytes: GRAPH_SIMPLE_UPLOAD_MAX_BYTES,
    s3: {
      bucket: Bucket,
      key,
      size: objectSize,
      contentType,
      etag: head.ETag,
    },
    sharepoint: {
      path: `${destFolder}/${fileName}`,
      folderCreated: folderResult.created,
      itemId: meta.id,
      name: meta.name,
      size: meta.size,
      webUrl: meta.webUrl,
      mimeType: meta.file?.mimeType || contentType,
      parentReference: meta.parentReference,
      createdDateTime: meta.createdDateTime,
      lastModifiedDateTime: meta.lastModifiedDateTime,
    },
    integrity: {
      algorithm: 'sha256',
      sourceHash,
      destinationHash,
      match: hashMatch,
      sizeMatch,
      note: hashNote,
    },
  };
}

function rethrowGraphAsSync(error) {
  if (error?.code === 'INVALID_TEST_PATH' || error?.code === 'INVALID_SHAREPOINT_PATH') {
    throw error instanceof SyncError
      ? error
      : new SyncError(error.code || 'INVALID_SHAREPOINT_PATH', error.message, error);
  }
  if (error instanceof SharePointAuthError) {
    const code =
      error.code === 'SHAREPOINT_PERMISSION_ERROR' || error?.cause?.status === 403
        ? 'SHAREPOINT_PERMISSION_ERROR'
        : 'SHAREPOINT_AUTH_ERROR';
    throw new SyncError(code, error.message, error);
  }
  if (error instanceof SharePointGraphError) {
    if (error.status === 403) {
      throw new SyncError('SHAREPOINT_PERMISSION_ERROR', error.message, error);
    }
    if (error.status === 401) {
      throw new SyncError('SHAREPOINT_AUTH_ERROR', error.message, error);
    }
    throw new SyncError('SHAREPOINT_UPLOAD_ERROR', error.message, error);
  }
  if (error?.code && String(error.code).startsWith('SHAREPOINT')) {
    throw new SyncError(error.code, error.message, error);
  }
  throw new SyncError('SHAREPOINT_UPLOAD_ERROR', error.message || 'Error SharePoint', error);
}
