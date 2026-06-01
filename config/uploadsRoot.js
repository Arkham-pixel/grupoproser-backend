import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirnameConfig = path.dirname(__filename);

/**
 * Raíz de archivos en DISCO (modo local y legacy tras migración a S3).
 *
 * En despliegue con STORAGE_DRIVER=s3 los archivos nuevos van al bucket;
 * ver `config/storage.js`, `services/fileStorageService.js` y docs/STORAGE_S3_DESPLIEGUE.md.
 *
 * Siempre `backend/uploads`, sin depender de `process.cwd()` (evita que /uploads estático
 * apunte a una carpeta y multer/subida guarden en otra).
 */
export const UPLOADS_ROOT = path.join(__dirnameConfig, '..', 'uploads');
export const DOCUMENTOS_UPLOADS_DIR = path.join(UPLOADS_ROOT, 'documentos');
export const RIESGOS_UPLOADS_DIR = path.join(UPLOADS_ROOT, 'riesgos');
export const EXPRESS_UPLOADS_DIR = path.join(UPLOADS_ROOT, 'express');

/** Carpeta legacy cuando PM2 cwd es la raíz del repo. */
export function legacyUploadsRoot() {
  return path.resolve('uploads');
}

export function ensureUploadDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

/**
 * Resuelve /uploads/... buscando primero en backend/uploads y luego en uploads/ legacy.
 */
export function resolveUploadRelativePath(relativePath = '') {
  const normalized = String(relativePath || '').replace(/^\/+/, '');
  if (!normalized.startsWith('uploads/')) {
    return path.join(UPLOADS_ROOT, normalized.replace(/^uploads\/?/, ''));
  }
  const subPath = normalized.slice('uploads/'.length);
  const canonical = path.join(UPLOADS_ROOT, subPath);
  if (fs.existsSync(canonical)) return canonical;
  const legacy = path.join(legacyUploadsRoot(), subPath);
  if (legacy !== canonical && fs.existsSync(legacy)) return legacy;
  return canonical;
}

/**
 * Ruta del archivo en disco. Incluye fallback a uploads/documentos en cwd (legacy PM2).
 */
export function resolveDocumentoArchivoPath(nombreArchivo) {
  return resolveUploadRelativePath(`uploads/documentos/${nombreArchivo}`);
}
