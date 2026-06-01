/**
 * Configuración de almacenamiento de archivos (local | S3).
 *
 * Por defecto: local (backend/uploads) — comportamiento actual sin cambios.
 * En despliegue: STORAGE_DRIVER=s3 + variables AWS → subida solo a S3.
 *
 * Estructura de claves en S3:
 *   {año}/{semestre}/{usuarios|clientes}/{id}/{categoría}/{archivo}
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

export function isS3StorageEnabled() {
  return getStorageDriver() === STORAGE_DRIVERS.S3 && Boolean(process.env.AWS_S3_BUCKET?.trim());
}

export function isLocalStorageEnabled() {
  return !isS3StorageEnabled();
}

export const storageConfig = Object.freeze({
  driver: () => getStorageDriver(),
  bucket: () => process.env.AWS_S3_BUCKET?.trim() || '',
  region: () => process.env.AWS_REGION?.trim() || 'us-east-1',
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

/**
 * Semestre calendario: 1 = ene–jun, 2 = jul–dic.
 */
export function getSemester(date = new Date()) {
  const month = date.getMonth() + 1;
  return month <= 6 ? '1' : '2';
}

export function getStorageYear(date = new Date()) {
  return String(date.getFullYear());
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
    console.log('   Claves: año/semestre/usuario|cliente/categoría/archivo');
  } else {
    console.log('📂 Almacenamiento LOCAL (backend/uploads). S3 listo; activar con STORAGE_DRIVER=s3 en despliegue.');
  }
}
