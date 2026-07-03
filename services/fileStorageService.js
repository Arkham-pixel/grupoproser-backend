import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import {
  canAccessS3Bucket,
  isS3StorageEnabled,
  isLocalStorageEnabled,
  storageConfig,
} from '../config/storage.js';
import {
  buildS3ObjectKey,
  extensionFromOriginalName,
  parseS3KeyFromStoredPath,
  resolveOwnerFromRequest,
  resolveS3KeyCandidates,
  buildRecentStorageSearchPrefixes,
  extractS3PathHints,
  toLocalUploadPathFromStoredRef,
  canonicalStoredFileReference,
} from '../utils/storageKeyBuilder.js';
import * as s3 from './s3StorageService.js';
import {
  UPLOADS_ROOT,
  resolveUploadRelativePath,
} from '../config/uploadsRoot.js';

/** Categorías alineadas con carpetas actuales en uploads/ */
export const STORAGE_CATEGORIES = Object.freeze({
  DOCUMENTOS: 'documentos',
  HISTORIAL: 'historial',
  EXPRESS: 'express',
  RIESGOS: 'riesgos',
  PERFILES: 'perfiles',
  COMPLEX: 'complex',
  PUERTOS: 'puertos',
  GENERAL: 'general',
});

/**
 * Genera nombre único para archivo (mismo estilo que multer actual).
 */
export function generateUniqueFilename(originalName) {
  const ext = extensionFromOriginalName(originalName);
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
}

/**
 * Construye clave S3 para una subida nueva.
 */
export function buildKeyForUpload(req, { category, originalName, ownerType, ownerId, date }) {
  const owner = resolveOwnerFromRequest(req, { ownerType, ownerId });
  const filename = generateUniqueFilename(originalName);
  const key = buildS3ObjectKey({
    ownerType: owner.ownerType,
    ownerId: owner.ownerId,
    category,
    filename,
    date,
  });
  return { key, filename, owner };
}

/**
 * Ruta pública almacenada en BD.
 * - Local: /uploads/...
 * - S3: s3:{key} (interno) o URL pública si está configurada
 */
export function buildStoredPublicPath({ driver, category, filename, s3Key }) {
  if (driver === 's3' && s3Key) {
    const publicUrl = s3.getPublicObjectUrl(s3Key);
    if (publicUrl) return publicUrl;
    return `s3:${s3Key}`;
  }
  if (category === STORAGE_CATEGORIES.DOCUMENTOS) {
    return `/uploads/documentos/${filename}`;
  }
  if (category === STORAGE_CATEGORIES.RIESGOS) {
    return `/uploads/riesgos/${filename}`;
  }
  if (category === STORAGE_CATEGORIES.EXPRESS) {
    return `/uploads/express/${filename}`;
  }
  return `/uploads/${filename}`;
}

/**
 * Guarda un archivo subido (buffer o ruta temporal en disco).
 * No se usa hasta STORAGE_DRIVER=s3; en local delega al flujo multer existente.
 */
export async function persistUploadedFile({
  req,
  file,
  category = STORAGE_CATEGORIES.GENERAL,
  ownerType,
  ownerId,
}) {
  if (!file) {
    throw new Error('No se proporcionó archivo');
  }

  if (isLocalStorageEnabled()) {
    return {
      driver: 'local',
      filename: file.filename,
      localPath: file.path,
      publicPath: buildStoredPublicPath({ driver: 'local', category, filename: file.filename }),
      size: file.size,
      mimetype: file.mimetype,
    };
  }

  const { key, filename } = buildKeyForUpload(req, {
    category,
    originalName: file.originalname,
    ownerType,
    ownerId,
  });

  let body;
  if (file.buffer) {
    body = file.buffer;
  } else if (file.path) {
    body = await fsp.readFile(file.path);
  } else {
    throw new Error('Archivo sin buffer ni path');
  }

  const S3_TIMEOUT_MS = 60000;
  await Promise.race([
    s3.putObject({
      key,
      body,
      contentType: file.mimetype,
      metadata: {
        originalName: file.originalname,
        category,
      },
    }),
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`Subida a S3 superó ${S3_TIMEOUT_MS / 1000}s (${file.originalname || 'imagen'})`)),
        S3_TIMEOUT_MS
      );
    }),
  ]);
  console.log(`☁️ S3 putObject OK — ${key}`);

  if (file.path && fs.existsSync(file.path)) {
    await fsp.unlink(file.path).catch(() => {});
  }

  return {
    driver: 's3',
    s3Key: key,
    filename,
    publicPath: buildStoredPublicPath({ driver: 's3', s3Key: key, filename, category }),
    size: file.size,
    mimetype: file.mimetype,
  };
}

/**
 * Resuelve ubicación para lectura (descarga, adjuntos email, etc.).
 */
async function resolveLocalFileForRead(storedPathOrKey) {
  const localUploadPath = toLocalUploadPathFromStoredRef(storedPathOrKey);
  let relative = localUploadPath || storedPathOrKey;
  if (relative.startsWith('/uploads/')) {
    relative = relative.slice(1);
  } else if (relative.startsWith('s3:')) {
    return { driver: 'local', localPath: null, exists: false };
  }
  const localPath = resolveUploadRelativePath(relative);
  if (!fs.existsSync(localPath)) {
    return { driver: 'local', localPath, exists: false };
  }
  return {
    driver: 'local',
    localPath,
    exists: true,
    stream: fs.createReadStream(localPath),
  };
}

function isS3MissingObjectError(error) {
  return (
    error?.name === 'NoSuchKey' ||
    error?.name === 'NotFound' ||
    error?.$metadata?.httpStatusCode === 404
  );
}

async function tryReadS3Key(s3Key) {
  const obj = await s3.getObjectStream(s3Key);
  return {
    driver: 's3',
    s3Key,
    stream: obj.Body,
    contentType: obj.ContentType,
    contentLength: obj.ContentLength,
  };
}

async function resolveS3FileForRead(storedPathOrKey) {
  if (!canAccessS3Bucket()) return null;

  const keys = resolveS3KeyCandidates(storedPathOrKey);
  if (!keys.length) return null;

  let lastError;
  for (const s3Key of keys) {
    try {
      return await tryReadS3Key(s3Key);
    } catch (error) {
      lastError = error;
      if (!isS3MissingObjectError(error)) throw error;
    }
  }

  const primary = keys[0];
  const hints = extractS3PathHints(primary);
  if (hints?.filename) {
    const bucketPrefix = storageConfig.keyPrefix();
    const searchPrefixes = buildRecentStorageSearchPrefixes().map((p) =>
      bucketPrefix ? `${bucketPrefix}/${p}` : p
    );
    searchPrefixes.push(...buildRecentStorageSearchPrefixes());

    const discovered = await s3.findObjectKeysByFilename(hints.filename, {
      ownerId: hints.ownerId,
      category: hints.category,
      searchPrefixes,
      maxResults: 3,
    });

    for (const s3Key of discovered) {
      try {
        return await tryReadS3Key(s3Key);
      } catch (error) {
        lastError = error;
        if (!isS3MissingObjectError(error)) throw error;
      }
    }
  }

  if (lastError) throw lastError;
  return null;
}

export async function resolveFileForRead(storedPathOrKey) {
  if (parseS3KeyFromStoredPath(storedPathOrKey) && canAccessS3Bucket()) {
    try {
      const fromS3 = await resolveS3FileForRead(storedPathOrKey);
      if (fromS3) return fromS3;
    } catch (error) {
      const localFallback = await resolveLocalFileForRead(storedPathOrKey);
      if (localFallback.exists) return localFallback;
      throw error;
    }
  }

  const local = await resolveLocalFileForRead(storedPathOrKey);
  if (local.exists) return local;

  if (parseS3KeyFromStoredPath(storedPathOrKey) && canAccessS3Bucket()) {
    return resolveS3FileForRead(storedPathOrKey);
  }

  return local;
}

/**
 * URL de descarga (firmada en S3 si no hay CDN pública).
 */
export async function getDownloadUrl(storedPathOrKey) {
  const s3Keys = resolveS3KeyCandidates(storedPathOrKey);
  if (s3Keys.length && canAccessS3Bucket()) {
    for (const s3Key of s3Keys) {
      const publicUrl = s3.getPublicObjectUrl(s3Key);
      if (publicUrl) return publicUrl;
      try {
        return await s3.getSignedDownloadUrl(s3Key);
      } catch (error) {
        const missing =
          error?.name === 'NoSuchKey' ||
          error?.name === 'NotFound' ||
          error?.$metadata?.httpStatusCode === 404;
        if (!missing) throw error;
      }
    }
  }
  if (storedPathOrKey.startsWith('http://') || storedPathOrKey.startsWith('https://')) {
    return storedPathOrKey;
  }
  return storedPathOrKey;
}

/** Indica si un valor guardado en BD apunta a un archivo en S3 o en uploads locales. */
export function isStoredFileReference(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('data:')) return false;
  if (trimmed.startsWith('s3:') || trimmed.startsWith('s3://')) return true;
  if (trimmed.startsWith('/uploads/')) return true;
  const publicBase = storageConfig.publicBaseUrl();
  if (publicBase && trimmed.startsWith(`${publicBase}/`)) return true;
  return false;
}

export async function deleteStoredFile(storedPathOrKey) {
  if (!isStoredFileReference(storedPathOrKey)) {
    return { deleted: false };
  }

  const s3Keys = resolveS3KeyCandidates(storedPathOrKey);
  if (s3Keys.length && canAccessS3Bucket()) {
    for (const s3Key of s3Keys) {
      try {
        await s3.deleteObject(s3Key);
        return { deleted: true, driver: 's3', key: s3Key };
      } catch (error) {
        const missing =
          error?.name === 'NoSuchKey' ||
          error?.name === 'NotFound' ||
          error?.$metadata?.httpStatusCode === 404;
        if (!missing) throw error;
      }
    }
  }

  const localUploadPath = toLocalUploadPathFromStoredRef(storedPathOrKey);
  let relative = (localUploadPath || storedPathOrKey).trim();
  if (relative.startsWith('/uploads/')) relative = relative.slice(1);
  if (relative.startsWith('s3:')) return { deleted: false };
  const localPath = resolveUploadRelativePath(relative);
  if (fs.existsSync(localPath)) {
    await fsp.unlink(localPath);
    return { deleted: true, driver: 'local', path: localPath };
  }
  return { deleted: false };
}

/** Elimina varios archivos almacenados (S3 o local). Ignora rutas inválidas. */
export async function deleteStoredFiles(paths = []) {
  const unique = [...new Set(paths.filter(isStoredFileReference))];
  if (!unique.length) return { attempted: 0, deleted: 0 };

  const results = await Promise.allSettled(unique.map((p) => deleteStoredFile(p)));
  const deleted = results.filter((r) => r.status === 'fulfilled' && r.value?.deleted).length;
  return { attempted: unique.length, deleted };
}

/** Borra archivos que estaban antes y ya no están en la lista nueva (p. ej. anexos quitados). */
export async function deleteOrphanedStoredFiles(previousPaths = [], nextPaths = []) {
  const nextCanonical = new Set(
    nextPaths
      .filter(isStoredFileReference)
      .map((p) => canonicalStoredFileReference(p))
      .filter(Boolean)
  );

  const orphaned = [];
  const seen = new Set();
  for (const path of previousPaths.filter(isStoredFileReference)) {
    const canonical = canonicalStoredFileReference(path);
    if (!canonical || nextCanonical.has(canonical)) continue;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    orphaned.push(path);
  }

  return deleteStoredFiles(orphaned);
}

/** Borra el archivo anterior cuando se reemplaza por otro. */
export async function deleteReplacedStoredFile(oldPath, newPath) {
  if (!oldPath || !isStoredFileReference(oldPath)) return { deleted: false };
  if (newPath) {
    const prev = canonicalStoredFileReference(oldPath);
    const next = canonicalStoredFileReference(newPath);
    if (prev && next && prev === next) return { deleted: false };
  }
  return deleteStoredFile(oldPath);
}

/** Ruta local para multer cuando driver=local (sin cambios). */
export function getLocalMulterDestination(category, subfolder) {
  if (subfolder) {
    return path.join(UPLOADS_ROOT, category, subfolder);
  }
  const map = {
    [STORAGE_CATEGORIES.DOCUMENTOS]: path.join(UPLOADS_ROOT, 'documentos'),
    [STORAGE_CATEGORIES.RIESGOS]: path.join(UPLOADS_ROOT, 'riesgos'),
    [STORAGE_CATEGORIES.EXPRESS]: path.join(UPLOADS_ROOT, 'express'),
    [STORAGE_CATEGORIES.HISTORIAL]: path.join(UPLOADS_ROOT, 'historial'),
  };
  return map[category] || UPLOADS_ROOT;
}

/**
 * Persiste todos los archivos del request en S3 (single, array o fields).
 */
export async function persistAllUploadedFiles(req, { category, ownerType, ownerIdFromReq } = {}) {
  if (!isS3StorageEnabled()) return;

  const ownerId =
    typeof ownerIdFromReq === 'function' ? ownerIdFromReq(req) : ownerIdFromReq;

  req.filesStorage = req.filesStorage || {};

  if (req.file) {
    req.fileStorage = await persistUploadedFile({
      req,
      file: req.file,
      category,
      ownerType,
      ownerId,
    });
    return;
  }

  if (Array.isArray(req.files)) {
    req.filesStorage.__array = [];
    for (const file of req.files) {
      req.filesStorage.__array.push(
        await persistUploadedFile({ req, file, category, ownerType, ownerId })
      );
    }
    return;
  }

  if (req.files && typeof req.files === 'object') {
    for (const [field, fileList] of Object.entries(req.files)) {
      if (!Array.isArray(fileList)) continue;
      req.filesStorage[field] = [];
      for (const file of fileList) {
        req.filesStorage[field].push(
          await persistUploadedFile({ req, file, category, ownerType, ownerId })
        );
      }
    }
  }
}

export function getPublicPathForSingle(req, localPathBuilder) {
  if (req.fileStorage?.publicPath) return req.fileStorage.publicPath;
  if (req.file && typeof localPathBuilder === 'function') return localPathBuilder(req.file);
  return null;
}

export function getPublicPathForField(req, fieldName, index = 0, localPathBuilder) {
  const persisted = req.filesStorage?.[fieldName]?.[index];
  if (persisted?.publicPath) return persisted.publicPath;
  const file = req.files?.[fieldName]?.[index];
  if (file && typeof localPathBuilder === 'function') return localPathBuilder(file);
  return null;
}

export function getPersistedForField(req, fieldName, index = 0) {
  return req.filesStorage?.[fieldName]?.[index] ?? null;
}

export function getPersistedForArrayIndex(req, index = 0) {
  return req.filesStorage?.__array?.[index] ?? null;
}

export { isS3StorageEnabled, isLocalStorageEnabled, storageConfig };
