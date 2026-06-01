/**
 * JWT firmado con HS256: el secreto debe ser fuerte en producción.
 * - Producción (NODE_ENV=production): JWT_SECRET obligatorio; sin él el proceso termina.
 * - Desarrollo: si falta, se usa un valor local documentado (advertencia en consola).
 */
import './loadEnv.js';

const IS_PROD = process.env.NODE_ENV === 'production';

/** Solo para desarrollo local cuando no hay .env; nunca usar en producción. */
const DEV_FALLBACK =
  'DEV_ONLY_set_JWT_SECRET_in_env_see_backend_env_example';

function resolveJwtSecret() {
  const raw = process.env.JWT_SECRET?.trim();
  if (raw) return raw;

  if (IS_PROD) {
    console.error('');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('  ERROR: JWT_SECRET es obligatorio en producción.');
    console.error('  Defina la variable de entorno JWT_SECRET antes de arrancar.');
    console.error('  Ver backend/.env.example');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('');
    process.exit(1);
  }

  console.warn('');
  console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.warn('  ADVERTENCIA (solo desarrollo): JWT_SECRET no está definido.');
  console.warn('  Se usa un secreto interno para poder arrancar en local.');
  console.warn('  Cree backend/.env con JWT_SECRET=<valor fuerte> (ver .env.example).');
  console.warn('  En producción (NODE_ENV=production) el servidor no arrancará sin JWT_SECRET.');
  console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.warn('');

  return DEV_FALLBACK;
}

export const JWT_SECRET = resolveJwtSecret();
