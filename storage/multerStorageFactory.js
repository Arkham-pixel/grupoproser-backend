import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { isS3StorageEnabled } from '../config/storage.js';
import { ensureUploadDir } from '../config/uploadsRoot.js';
import { getLocalMulterDestination } from '../services/fileStorageService.js';
import { generateUniqueFilename } from '../services/fileStorageService.js';

/**
 * Factory de multer para migración gradual a S3.
 *
 * - STORAGE_DRIVER=local (defecto): diskStorage idéntico al comportamiento actual.
 * - STORAGE_DRIVER=s3: memoryStorage (archivo en RAM); tras upload usar persistUploadedFile().
 *
 * Las rutas actuales pueden seguir con su multer.diskStorage hasta el despliegue;
 * al migrar, reemplazar por createMulterUpload({ category, ... }).
 */
export function createMulterDiskStorage({ category, subfolder, filenameFn }) {
  const destDir = ensureUploadDir(getLocalMulterDestination(category, subfolder));

  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destDir),
    filename: (req, file, cb) => {
      if (filenameFn) return filenameFn(req, file, cb);
      cb(null, generateUniqueFilename(file.originalname));
    },
  });
}

export function createMulterMemoryStorage() {
  return multer.memoryStorage();
}

/**
 * @param {object} opts
 * @param {string} opts.category
 * @param {string} [opts.subfolder]
 * @param {Function} [opts.filenameFn]
 * @param {object} [opts.multerOptions] - fileFilter, limits, etc.
 */
export function createMulterUpload(opts = {}) {
  const { category, subfolder, filenameFn, multerOptions = {} } = opts;
  const storage = isS3StorageEnabled()
    ? createMulterMemoryStorage()
    : createMulterDiskStorage({ category, subfolder, filenameFn });

  return multer({ storage, ...multerOptions });
}

/**
 * Middleware post-multer: en S3 sube el buffer y adjunta metadata en req.fileStorage.
 * En local no hace nada (req.file ya tiene path en disco).
 */
export function attachPersistedFileMiddleware({ category, ownerType, ownerIdFromReq }) {
  return async (req, res, next) => {
    if (!isS3StorageEnabled() || !req.file) {
      return next();
    }
    try {
      const { persistUploadedFile } = await import('../services/fileStorageService.js');
      const ownerId =
        typeof ownerIdFromReq === 'function' ? ownerIdFromReq(req) : ownerIdFromReq;
      req.fileStorage = await persistUploadedFile({
        req,
        file: req.file,
        category,
        ownerType,
        ownerId,
      });
      next();
    } catch (err) {
      next(err);
    }
  };
}
