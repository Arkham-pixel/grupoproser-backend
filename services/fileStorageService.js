import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import {
  isS3StorageEnabled,
  isLocalStorageEnabled,
  storageConfig,
} from '../config/storage.js';
import {
  buildS3ObjectKey,
  extensionFromOriginalName,
  parseS3KeyFromStoredPath,
  resolveOwnerFromRequest,
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

  await s3.putObject({
    key,
    body,
    contentType: file.mimetype,
    metadata: {
      originalName: file.originalname,
      category,
    },
  });

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
export async function resolveFileForRead(storedPathOrKey) {
  const s3Key = parseS3KeyFromStoredPath(storedPathOrKey);
  if (s3Key && isS3StorageEnabled()) {
    const obj = await s3.getObjectStream(s3Key);
    return {
      driver: 's3',
      s3Key,
      stream: obj.Body,
      contentType: obj.ContentType,
      contentLength: obj.ContentLength,
    };
  }

  let relative = storedPathOrKey;
  if (relative.startsWith('/uploads/')) {
    relative = relative.slice(1);
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

/**
 * URL de descarga (firmada en S3 si no hay CDN pública).
 */
export async function getDownloadUrl(storedPathOrKey) {
  const s3Key = parseS3KeyFromStoredPath(storedPathOrKey);
  if (s3Key && isS3StorageEnabled()) {
    const publicUrl = s3.getPublicObjectUrl(s3Key);
    if (publicUrl) return publicUrl;
    return s3.getSignedDownloadUrl(s3Key);
  }
  if (storedPathOrKey.startsWith('http://') || storedPathOrKey.startsWith('https://')) {
    return storedPathOrKey;
  }
  return storedPathOrKey;
}

export async function deleteStoredFile(storedPathOrKey) {
  const s3Key = parseS3KeyFromStoredPath(storedPathOrKey);
  if (s3Key && isS3StorageEnabled()) {
    await s3.deleteObject(s3Key);
    return { deleted: true, driver: 's3', key: s3Key };
  }

  let relative = storedPathOrKey;
  if (relative.startsWith('/uploads/')) relative = relative.slice(1);
  const localPath = resolveUploadRelativePath(relative);
  if (fs.existsSync(localPath)) {
    await fsp.unlink(localPath);
    return { deleted: true, driver: 'local', path: localPath };
  }
  return { deleted: false };
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

export { isS3StorageEnabled, isLocalStorageEnabled, storageConfig };
