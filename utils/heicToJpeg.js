import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import convertPkg from 'heic-convert';

const convert = typeof convertPkg === 'function' ? convertPkg : convertPkg.default;

const HEIC_EXT = /\.hei[cf]$/i;
const JPEG_CACHE_MAX = 24;
const jpegCache = new Map();

export function nombreJpegDesdeHeic(nombre) {
  const raw = String(nombre || 'foto.heic').trim() || 'foto.heic';
  if (HEIC_EXT.test(raw)) return raw.replace(HEIC_EXT, '.jpg');
  if (/\.jpe?g$/i.test(raw)) return raw;
  const sinExt = raw.replace(/\.[^.]+$/, '');
  return `${sinExt || 'foto'}.jpg`;
}

function brandHeic(buffer) {
  if (!buffer || buffer.length < 12) return '';
  return buffer.subarray(4, 12).toString('ascii');
}

export function esHeic({ buffer, mimetype, filename } = {}) {
  const mime = String(mimetype || '').toLowerCase();
  const name = String(filename || '');
  if (mime.includes('heic') || mime.includes('heif')) return true;
  if (HEIC_EXT.test(name)) return true;
  const brand = brandHeic(buffer);
  if (brand.startsWith('ftyp')) {
    const tipo = brand.slice(4).toLowerCase();
    return /hei[cfx]|mif1|msf1|hevc/.test(tipo);
  }
  return false;
}

export async function readableToBuffer(stream) {
  if (!stream) return Buffer.alloc(0);
  if (Buffer.isBuffer(stream)) return stream;
  if (typeof stream === 'string') return Buffer.from(stream);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function convertirHeicBufferAJpeg(buffer, quality = 0.82) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const jpeg = await convert({
    buffer: input,
    format: 'JPEG',
    quality,
  });
  return Buffer.from(jpeg);
}

function cacheGet(key) {
  if (!key || !jpegCache.has(key)) return null;
  const val = jpegCache.get(key);
  jpegCache.delete(key);
  jpegCache.set(key, val);
  return val;
}

function cacheSet(key, buf) {
  if (!key || !buf || buf.length > 8 * 1024 * 1024) return;
  jpegCache.set(key, buf);
  while (jpegCache.size > JPEG_CACHE_MAX) {
    const first = jpegCache.keys().next().value;
    jpegCache.delete(first);
  }
}

/**
 * Si el archivo multer es HEIC, lo convierte a JPEG (buffer o disco).
 */
export async function normalizarHeicEnArchivoMulter(file) {
  if (!file) return file;

  let buf = null;
  if (file.buffer) {
    buf = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
  } else if (file.path && fs.existsSync(file.path)) {
    buf = await fsp.readFile(file.path);
  } else {
    return file;
  }

  if (
    !esHeic({
      buffer: buf,
      mimetype: file.mimetype,
      filename: file.originalname || file.filename,
    })
  ) {
    return file;
  }

  try {
    const jpeg = await convertirHeicBufferAJpeg(buf);
    const jpegOriginal = nombreJpegDesdeHeic(file.originalname || file.filename || 'foto.heic');
    file.originalname = jpegOriginal;
    file.mimetype = 'image/jpeg';
    file.size = jpeg.length;

    if (file.buffer) {
      file.buffer = jpeg;
    }

    if (file.path) {
      const dir = path.dirname(file.path);
      const newFilename = nombreJpegDesdeHeic(file.filename || jpegOriginal);
      const newPath = path.join(dir, newFilename);
      await fsp.writeFile(newPath, jpeg);
      if (path.resolve(newPath) !== path.resolve(file.path)) {
        await fsp.unlink(file.path).catch(() => {});
      }
      file.path = newPath;
      file.filename = newFilename;
    }

    return file;
  } catch (err) {
    console.error('❌ No se pudo convertir HEIC al guardar:', err.message);
    return file;
  }
}

function metaHeicDeResolved(resolved = {}) {
  const filename = String(resolved.s3Key || resolved.localPath || '');
  return esHeic({
    mimetype: resolved.contentType,
    filename,
  });
}

/**
 * Sirve el archivo; si es HEIC, responde JPEG para que el navegador lo pinte.
 * @returns {boolean} true si ya se envió la respuesta
 */
export async function enviarArchivoCompatibleNavegador(resolved, res) {
  if (!resolved) return false;

  const cacheKey = resolved.s3Key || resolved.localPath || '';
  const hayQueConvertir = metaHeicDeResolved(resolved);

  if (!hayQueConvertir) {
    if (resolved.driver === 's3' && resolved.stream) {
      res.setHeader('Content-Type', resolved.contentType || 'application/octet-stream');
      if (resolved.contentLength) {
        res.setHeader('Content-Length', resolved.contentLength);
      }
      resolved.stream.pipe(res);
      return true;
    }
    return false;
  }

  const cached = cacheGet(cacheKey);
  if (cached) {
    if (resolved.stream?.destroy) resolved.stream.destroy();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', cached.length);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(cached);
    return true;
  }

  try {
    let buf;
    if (resolved.stream) {
      buf = await readableToBuffer(resolved.stream);
    } else if (resolved.localPath) {
      buf = await fsp.readFile(resolved.localPath);
    } else {
      return false;
    }

    if (!esHeic({ buffer: buf, mimetype: resolved.contentType, filename: cacheKey })) {
      res.setHeader('Content-Type', resolved.contentType || 'application/octet-stream');
      res.setHeader('Content-Length', buf.length);
      res.send(buf);
      return true;
    }

    const jpeg = await convertirHeicBufferAJpeg(buf);
    cacheSet(cacheKey, jpeg);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', jpeg.length);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(jpeg);
    return true;
  } catch (err) {
    console.error('❌ No se pudo convertir HEIC a JPEG:', err.message);
    if (typeof buf !== 'undefined' && buf) {
      res.setHeader('Content-Type', resolved.contentType || 'application/octet-stream');
      res.setHeader('Content-Length', buf.length);
      res.send(buf);
      return true;
    }
    return false;
  }
}

export async function servirHeicLocalComoJpeg(req, res, next, uploadsRoot) {
  try {
    const rel = decodeURIComponent(req.path || '').replace(/^\/+/, '');
    if (!HEIC_EXT.test(rel)) return next();
    const full = path.resolve(uploadsRoot, rel);
    const root = path.resolve(uploadsRoot);
    if (!full.startsWith(root + path.sep) && full !== root) return next();
    if (!fs.existsSync(full)) return next();
    const buf = await fsp.readFile(full);
    const jpeg = await convertirHeicBufferAJpeg(buf);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.send(jpeg);
  } catch (err) {
    console.error('❌ HEIC local:', err.message);
    return next();
  }
}
