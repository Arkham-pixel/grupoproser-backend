/**
 * Configuración de almacenamiento de archivos (local | S3).
 *
 * Por defecto: local (backend/uploads) — comportamiento actual sin cambios.
 * En despliegue: STORAGE_DRIVER=s3 + variables AWS → subida solo a S3.
 *
 * Estructura de claves en S3:
 *   {año}/{trimestre}/{mes}/{día}/{usuarios|clientes}/{id}/{categoría}/{archivo}
 */

export const STORAGE_DRIVERS = Object.freeze({
  LOCAL: 'local',
  S3: 's3',
});

const DEFAULT_DRIVER = STORAGE_DRIVERS.LOCAL;

function envFlag(name, defaultValue = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultValue;
  return v === 'true' || v === '1';
}

export function getStorageDriver() {
  const raw = String(process.env.STORAGE_DRIVER || DEFAULT_DRIVER).trim().toLowerCase();
  return raw === STORAGE_DRIVERS.S3 ? STORAGE_DRIVERS.S3 : STORAGE_DRIVERS.LOCAL;
}

export function isS3BucketConfigured() {
  const bucket =
    process.env.AWS_S3_BUCKET?.trim() ||
    process.env.AWS_BUCKET_NAME?.trim() ||
    '';
  return Boolean(bucket);
}

/** Subidas nuevas van a S3 solo con STORAGE_DRIVER=s3. */
export function isS3StorageEnabled() {
  return getStorageDriver() === STORAGE_DRIVERS.S3 && isS3BucketConfigured();
}

/** Lectura/borrado de referencias s3:… requiere bucket (aunque el driver local siga activo en dev). */
export function canAccessS3Bucket() {
  return isS3BucketConfigured();
}

export function isLocalStorageEnabled() {
  return !isS3StorageEnabled();
}

export const storageConfig = Object.freeze({
  driver: () => getStorageDriver(),
  bucket: () =>
    process.env.AWS_S3_BUCKET?.trim() ||
    process.env.AWS_BUCKET_NAME?.trim() ||
    '',
  region: () => process.env.AWS_REGION?.trim() || 'us-east-1',
  /** Endpoint personalizado (MinIO, Coolify, etc.). Ej: https://s3.us-east-2.amazonaws.com */
  endpoint: () => process.env.AWS_S3_ENDPOINT?.trim().replace(/\/$/, '') || '',
  forcePathStyle: () => envFlag('AWS_S3_FORCE_PATH_STYLE', false),
  /** Crear bucket al arrancar si no existe (solo dev; requiere s3:CreateBucket) */
  autoCreateBucket: () => envFlag('AWS_S3_AUTO_CREATE_BUCKET', false),
  /** Prefijo opcional dentro del bucket (ej. "proser-prod") */
  keyPrefix: () => {
    const p = process.env.AWS_S3_KEY_PREFIX?.trim();
    return p ? p.replace(/^\/+|\/+$/g, '') : '';
  },
  /** URL pública base (CloudFront o bucket website). Si no hay, se usan URLs firmadas. */
  publicBaseUrl: () => process.env.AWS_S3_PUBLIC_BASE_URL?.trim().replace(/\/$/, '') || '',
  signedUrlExpiresSeconds: () => {
    const n = parseInt(process.env.AWS_S3_SIGNED_URL_EXPIRES || '3600', 10);
    return Number.isFinite(n) && n > 0 ? n : 3600;
  },
  /** En S3, seguir sirviendo /uploads desde disco para archivos legacy migrados */
  serveLegacyLocalUploads: () =>
    isS3StorageEnabled() && envFlag('STORAGE_SERVE_LEGACY_LOCAL_UPLOADS', true),
});

export function getStorageYear(date = new Date()) {
  return String(date.getFullYear());
}

/** Trimestre calendario: 1 = ene–mar, 2 = abr–jun, 3 = jul–sep, 4 = oct–dic. */
export function getQuarter(date = new Date()) {
  const month = date.getMonth() + 1;
  return String(Math.ceil(month / 3));
}

/** Mes con cero a la izquierda (01–12) para orden lexicográfico en S3. */
export function getStorageMonth(date = new Date()) {
  return String(date.getMonth() + 1).padStart(2, '0');
}

/** Día del mes con cero a la izquierda (01–31). */
export function getStorageDay(date = new Date()) {
  return String(date.getDate()).padStart(2, '0');
}

/** Segmentos de fecha usados en rutas S3. */
export function getStorageDateSegments(date = new Date()) {
  return {
    year: getStorageYear(date),
    quarter: getQuarter(date),
    month: getStorageMonth(date),
    day: getStorageDay(date),
  };
}

export function logStorageStatusOnBoot() {
  const driver = getStorageDriver();
  if (driver === STORAGE_DRIVERS.S3 && !storageConfig.bucket()) {
    console.warn(
      '⚠️ STORAGE_DRIVER=s3 pero falta AWS_S3_BUCKET. Se usará almacenamiento LOCAL hasta configurar S3.'
    );
    return;
  }
  if (isS3StorageEnabled()) {
    console.log(
      `☁️ Almacenamiento S3 activo — bucket: ${storageConfig.bucket()}, región: ${storageConfig.region()}`
    );
    if (storageConfig.endpoint()) {
      console.log(`   Endpoint: ${storageConfig.endpoint()}`);
    }
    console.log('   Claves: año/trimestre/mes/día/usuario|cliente/categoría/archivo');
  } else if (isS3BucketConfigured()) {
    console.log(
      `📂 Subidas LOCAL — lectura S3 activa (bucket: ${storageConfig.bucket()}) para rutas s3: en BD`
    );
  } else {
    console.log('📂 Almacenamiento LOCAL (backend/uploads). S3 listo; activar con STORAGE_DRIVER=s3 en despliegue.');
  }
}

export async function verifyS3OnBoot() {
  if (!isS3StorageEnabled()) return;
  try {
    const { ensureBucketReady } = await import('../services/s3StorageService.js');
    await ensureBucketReady();
    console.log(`✅ Bucket S3 accesible: ${storageConfig.bucket()}`);
  } catch (error) {
    const { mapS3ErrorMessage } = await import('../services/s3StorageService.js');
    console.error('');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('  ❌ S3 NO DISPONIBLE — las subidas fallarán hasta corregir esto:');
    console.error(`  ${mapS3ErrorMessage(error)}`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('');
  }
}
