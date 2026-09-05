/**
 * Reduce peso de imágenes antes de PutObject a S3.
 * Usa sharp si está instalado; si no, deja el archivo igual.
 */

let _sharp = null;
let _sharpTried = false;

async function getSharp() {
  if (_sharpTried) return _sharp;
  _sharpTried = true;
  try {
    const mod = await import('sharp');
    _sharp = mod.default || mod;
  } catch {
    _sharp = null;
    console.warn('⚠️ sharp no disponible: no se optimizarán imágenes en el servidor antes de S3');
  }
  return _sharp;
}

function isRasterImage(mimetype = '', originalName = '') {
  const mime = String(mimetype || '').toLowerCase();
  const name = String(originalName || '').toLowerCase();
  if (mime.startsWith('image/') && !mime.includes('svg') && !mime.includes('gif')) return true;
  return /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(name);
}

function toJpegFileName(originalName = 'imagen.jpg') {
  const raw = String(originalName || 'imagen.jpg').trim() || 'imagen.jpg';
  const stem = raw.replace(/\.[^.]+$/i, '') || 'imagen';
  return `${stem}.jpg`;
}

/**
 * @param {{ buffer?: Buffer, path?: string, mimetype?: string, originalname?: string, size?: number }} file
 * @param {Buffer} body
 * @returns {Promise<{ body: Buffer, mimetype: string, originalname: string, size: number, optimized: boolean }>}
 */
export async function optimizeImageBufferForS3(file, body) {
  const input = Buffer.isBuffer(body) ? body : null;
  if (!input?.length) {
    return {
      body,
      mimetype: file?.mimetype,
      originalname: file?.originalname,
      size: file?.size || 0,
      optimized: false,
    };
  }

  if (!isRasterImage(file?.mimetype, file?.originalname)) {
    return {
      body: input,
      mimetype: file?.mimetype,
      originalname: file?.originalname,
      size: input.length,
      optimized: false,
    };
  }

  // No tocar GIFs animados / SVG
  const mime = String(file?.mimetype || '').toLowerCase();
  if (mime.includes('gif') || mime.includes('svg')) {
    return {
      body: input,
      mimetype: file?.mimetype,
      originalname: file?.originalname,
      size: input.length,
      optimized: false,
    };
  }

  const sharp = await getSharp();
  if (!sharp) {
    return {
      body: input,
      mimetype: file?.mimetype,
      originalname: file?.originalname,
      size: input.length,
      optimized: false,
    };
  }

  // Solo optimizar si pesa o es PNG/WebP (capturas)
  const needs =
    input.length > 700 * 1024 ||
    mime.includes('png') ||
    mime.includes('webp') ||
    mime.includes('bmp') ||
    /\.(png|webp|bmp)$/i.test(String(file?.originalname || ''));

  if (!needs) {
    return {
      body: input,
      mimetype: file?.mimetype,
      originalname: file?.originalname,
      size: input.length,
      optimized: false,
    };
  }

  try {
    const out = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize({
        width: 1920,
        height: 1080,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();

    // Si por alguna razón creció, conservar original
    if (!out?.length || out.length >= input.length * 0.98) {
      return {
        body: input,
        mimetype: file?.mimetype,
        originalname: file?.originalname,
        size: input.length,
        optimized: false,
      };
    }

    const originalname = toJpegFileName(file?.originalname);
    console.log(
      `🖼️ Imagen optimizada pre-S3: ${(input.length / 1024).toFixed(0)}KB → ${(out.length / 1024).toFixed(0)}KB (${file?.originalname || 'imagen'})`
    );

    return {
      body: out,
      mimetype: 'image/jpeg',
      originalname,
      size: out.length,
      optimized: true,
    };
  } catch (error) {
    console.warn('⚠️ Optimización de imagen omitida:', error?.message || error);
    return {
      body: input,
      mimetype: file?.mimetype,
      originalname: file?.originalname,
      size: input.length,
      optimized: false,
    };
  }
}
