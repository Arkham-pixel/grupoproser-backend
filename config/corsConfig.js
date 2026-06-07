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
import { PRODUCTION_CORS_ORIGINS } from './platformUrls.js';

const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:3000',
  'http://[::1]:5173',
  'http://[::1]:5174',
  'http://[::1]:3000'
];

/** Vite puede usar 5173, 5174, etc. si el puerto anterior está ocupado. */
function isLocalDevOrigin(origin) {
  if (!origin || process.env.NODE_ENV === 'production') return false;
  try {
    const { hostname, protocol } = new URL(origin);
    const local =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]';
    return local && (protocol === 'http:' || protocol === 'https:');
  } catch {
    return false;
  }
}

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
    ...PRODUCTION_CORS_ORIGINS,
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
      if (allowed.has(norm) || isLocalDevOrigin(origin)) {
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
