/**
 * CORS estricto: solo orígenes en lista permitida.
 * - Sin cabecera Origin (curl, Postman, healthchecks): se permite.
 * - Origen no listado: rechazado (callback false).
 *
 * Variables:
 * - CORS_ORIGIN, ALLOWED_ORIGINS: URLs separadas por comas (sin espacios raros).
 * - INCLUDE_LOCALHOST_CORS=true: en producción, incluye también localhost (solo debugging).
 */
import cors from 'cors';

const PROD_APP = 'https://aplicacion.grupoproser.com.co';
/** Front desplegado en Coolify (dominio distinto al API). */
const PROD_APP_COOLIFY = 'https://arnalddataflow.grupoproser.com.co';

const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://[::1]:5173',
  'http://[::1]:3000'
];

function parseOriginsEnv(value) {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function normalizeOrigin(origin) {
  if (!origin || typeof origin !== 'string') return '';
  return origin.trim().replace(/\/+$/, '');
}

function buildAllowedOriginSet() {
  const isProd = process.env.NODE_ENV === 'production';
  const includeLocal =
    !isProd || process.env.INCLUDE_LOCALHOST_CORS === 'true';

  const list = [
    PROD_APP,
    PROD_APP_COOLIFY,
    ...parseOriginsEnv(process.env.FRONTEND_URL),
    ...parseOriginsEnv(process.env.CORS_ORIGIN),
    ...parseOriginsEnv(process.env.ALLOWED_ORIGINS),
    ...(includeLocal ? LOCAL_DEV_ORIGINS : [])
  ];

  return new Set(list.map(normalizeOrigin).filter(Boolean));
}

export function createCorsOptions() {
  const allowed = buildAllowedOriginSet();

  return {
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      const norm = normalizeOrigin(origin);
      if (allowed.has(norm)) {
        return callback(null, true);
      }
      console.warn(
        `⚠️ CORS rechazado. Origen: "${origin}" (normalizado: "${norm}")`
      );
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-CSRF-Token',
      'X-XSRF-Token',
      'csrf-token'
    ]
  };
}

export function corsMiddleware() {
  return cors(createCorsOptions());
}
