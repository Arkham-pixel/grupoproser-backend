import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { isS3StorageEnabled } from '../config/storage.js';
import { ensureUploadDir } from '../config/uploadsRoot.js';
import {
  getLocalMulterDestination,
  generateUniqueFilename,
  persistAllUploadedFiles,
} from '../services/fileStorageService.js';

/**
 * Factory de multer para almacenamiento local o S3.
 *
 * - STORAGE_DRIVER=local: diskStorage (backend/uploads).
 * - STORAGE_DRIVER=s3: memoryStorage + persistAllUploadedFiles() tras multer.
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
 * Middleware post-multer: sube a S3 y adjunta metadata en req.fileStorage / req.filesStorage.
 */
export function attachPersistedFileMiddleware({ category, ownerType, ownerIdFromReq }) {
  return async (req, res, next) => {
    if (!isS3StorageEnabled()) return next();

    const hasFiles =
      req.file ||
      (Array.isArray(req.files) && req.files.length > 0) ||
      (req.files && typeof req.files === 'object' && Object.keys(req.files).length > 0);

    if (!hasFiles) return next();

    try {
      await persistAllUploadedFiles(req, { category, ownerType, ownerIdFromReq });
      next();
    } catch (err) {
      console.error('❌ Error persistiendo archivo en S3:', err.message);
      err.storageError = true;
      next(err);
    }
  };
}
