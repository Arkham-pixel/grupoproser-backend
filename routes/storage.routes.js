import express from 'express';
import path from 'path';
import {
  getDownloadUrl,
  isStoredFileReference,
  resolveFileForRead,
} from '../services/fileStorageService.js';
import { parseS3KeyFromStoredPath } from '../utils/storageKeyBuilder.js';
import { storageConfig } from '../config/storage.js';
import { enviarArchivoCompatibleNavegador } from '../utils/heicToJpeg.js';

const router = express.Router();

const esHeicRef = (ref = '') => /\.hei[cf](\?|$)/i.test(String(ref));

function proxyFileUrl(req, ref) {
  const base = `${req.protocol}://${req.get('host')}`;
  return `${base}/api/storage/file?ref=${encodeURIComponent(ref)}`;
}

/**
 * URL de descarga directa (firmada S3 / CDN) o proxy cuando hace falta.
 * GET /api/storage/signed-url?ref=s3:...
 *
 * HEIC → proxy (conversión JPEG en el backend).
 * Legacy /uploads → proxy o ruta local.
 * Resto S3 → URL firmada (el navegador baja sin saturar Node).
 */
router.get('/signed-url', async (req, res) => {
  try {
    const ref = req.query.ref;
    if (!ref || typeof ref !== 'string') {
      return res.status(400).json({ success: false, message: 'Parámetro ref requerido' });
    }

    const trimmed = ref.trim();
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Parámetro ref vacío' });
    }

    // data/blob: el front no debería pedir firma
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
      return res.json({ success: true, url: trimmed, mode: 'inline', expiresIn: null });
    }

    // Ya es URL http(s) absoluta (CDN/firmada previa)
    if (/^https?:\/\//i.test(trimmed) && !trimmed.includes('/api/storage/file')) {
      return res.json({ success: true, url: trimmed, mode: 'direct', expiresIn: null });
    }

    const s3Key = parseS3KeyFromStoredPath(trimmed);
    const expiresIn = storageConfig.signedUrlExpiresSeconds();

    // HEIC debe pasar por proxy para servir JPEG al navegador
    if (s3Key && esHeicRef(s3Key)) {
      return res.json({
        success: true,
        url: proxyFileUrl(req, trimmed),
        mode: 'proxy-heic',
        expiresIn: null,
      });
    }

    if (s3Key) {
      try {
        const url = await getDownloadUrl(trimmed);
        if (url && /^https?:\/\//i.test(url) && !url.includes('/api/storage/file')) {
          return res.json({
            success: true,
            url,
            mode: storageConfig.publicBaseUrl() ? 'cdn' : 'signed',
            expiresIn,
          });
        }
      } catch (err) {
        console.warn('⚠️ signed-url S3 falló, fallback proxy:', err.message);
      }
    }

    // Legacy local o fallback
    if (isStoredFileReference(trimmed) || trimmed.startsWith('/uploads/')) {
      return res.json({
        success: true,
        url: proxyFileUrl(req, trimmed.startsWith('s3:') || trimmed.startsWith('/uploads/')
          ? trimmed
          : trimmed),
        mode: 'proxy',
        expiresIn: null,
      });
    }

    return res.json({
      success: true,
      url: proxyFileUrl(req, trimmed),
      mode: 'proxy',
      expiresIn: null,
    });
  } catch (error) {
    console.error('❌ Error generando signed-url:', error.message);
    return res.status(500).json({
      success: false,
      message: 'No se pudo generar la URL de descarga',
      error: error.message,
    });
  }
});

/**
 * Sirve archivos almacenados en S3 (s3:clave) o legacy local (/uploads/...).
 * Query redirect=1 → 302 a URL firmada (descargas rápidas sin saturar Node).
 * Por defecto sigue haciendo streaming (compatibilidad HEIC / CSP antiguos).
 */
router.get('/file', async (req, res) => {
  try {
    const ref = req.query.ref;
    if (!ref || typeof ref !== 'string') {
      return res.status(400).json({ message: 'Parámetro ref requerido' });
    }

    const wantsRedirect =
      req.query.redirect === '1' ||
      req.query.redirect === 'true' ||
      req.query.mode === 'redirect';

    if (wantsRedirect && parseS3KeyFromStoredPath(ref) && !esHeicRef(ref)) {
      try {
        const url = await getDownloadUrl(ref);
        if (url && /^https?:\/\//i.test(url) && !url.includes('/api/storage/file')) {
          res.setHeader('Cache-Control', 'private, no-store');
          return res.redirect(302, url);
        }
      } catch (err) {
        console.warn('⚠️ redirect firmado falló, streaming:', err.message);
      }
    }

    const resolved = await resolveFileForRead(ref);

    const enviado = await enviarArchivoCompatibleNavegador(resolved, res);
    if (enviado) return;

    if (resolved.driver === 's3' && resolved.stream) {
      res.setHeader('Content-Type', resolved.contentType || 'application/octet-stream');
      if (resolved.contentLength) {
        res.setHeader('Content-Length', resolved.contentLength);
      }
      res.setHeader('Cache-Control', 'private, max-age=300');
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
