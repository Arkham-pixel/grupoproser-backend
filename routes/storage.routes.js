import express from 'express';
import path from 'path';
import { resolveFileForRead } from '../services/fileStorageService.js';

const router = express.Router();

/**
 * Sirve archivos almacenados en S3 (s3:clave) o legacy local (/uploads/...).
 * Usado por el frontend cuando la ruta guardada no es /uploads/ directo.
 * Siempre hace streaming vía el backend (sin redirect a S3) para cumplir CSP del front.
 */
router.get('/file', async (req, res) => {
  try {
    const ref = req.query.ref;
    if (!ref || typeof ref !== 'string') {
      return res.status(400).json({ message: 'Parámetro ref requerido' });
    }

    const resolved = await resolveFileForRead(ref);

    if (resolved.driver === 's3' && resolved.stream) {
      res.setHeader('Content-Type', resolved.contentType || 'application/octet-stream');
      if (resolved.contentLength) {
        res.setHeader('Content-Length', resolved.contentLength);
      }
      resolved.stream.pipe(res);
      return;
    }

    if (resolved.exists && resolved.localPath) {
      return res.sendFile(path.resolve(resolved.localPath));
    }

    return res.status(404).json({ message: 'Archivo no encontrado' });
  } catch (error) {
    console.error('❌ Error sirviendo archivo:', error.message);
    const missing =
      error?.name === 'NoSuchKey' ||
      error?.name === 'NotFound' ||
      error?.$metadata?.httpStatusCode === 404;
    if (missing) {
      return res.status(404).json({ message: 'Archivo no encontrado en S3' });
    }
    return res.status(500).json({ message: 'Error al servir archivo' });
  }
});

export default router;
