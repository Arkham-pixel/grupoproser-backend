import path from 'path';
import jwt from 'jsonwebtoken';
import { getStorageDateSegments, storageConfig } from '../config/storage.js';
import { JWT_SECRET } from '../config/secrets.js';

const SEGMENT_MAX = 120;

/**
 * Sanitiza un segmento de ruta S3 (sin barras ni caracteres problemáticos).
 */
export function sanitizeStorageSegment(value, fallback = 'sin-asignar') {
  const s = String(value ?? '').trim();
  if (!s) return fallback;
  return s
    .replace(/[/\\]+/g, '_')
    .replace(/[^a-zA-Z0-9._@-]/g, '_')
    .slice(0, SEGMENT_MAX);
}

export const STORAGE_OWNER_TYPES = Object.freeze({
  USUARIO: 'usuario',
  CLIENTE: 'cliente',
});

/**
 * Segmento de dueño: usuarios/{id} o clientes/{id}
 */
export function buildOwnerSegment(ownerType, ownerId) {
  const type = ownerType === STORAGE_OWNER_TYPES.CLIENTE ? 'clientes' : 'usuarios';
  const id = sanitizeStorageSegment(ownerId, 'general');
  return `${type}/${id}`;
}

/**
 * Extrae datos de autenticación del request (middleware o JWT en Authorization).
 */
function extractAuthFromRequest(req) {
  const fromMiddleware = req?.usuario || req?.user;
  if (fromMiddleware) return fromMiddleware;

  const authHeader = req?.headers?.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];
  if (!token) return null;

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    try {
      return jwt.decode(token);
    } catch {
      return null;
    }
  }
}

/**
 * Identificador legible para carpetas S3 (login > nombre > id).
 */
function resolveOwnerLabel(auth) {
  if (!auth) return null;
  return auth.login || auth.nombre || auth.name || auth.id || auth._id || null;
}

/**
 * Construye la clave S3 completa.
 *
 * @param {object} opts
 * @param {'usuario'|'cliente'} [opts.ownerType]
 * @param {string} [opts.ownerId]
 * @param {string} opts.category - documentos | historial | express | riesgos | perfiles | complex | general
 * @param {string} opts.filename - nombre final del archivo
 * @param {Date} [opts.date] - fecha de la subida (año/trimestre/mes/día en la ruta)
 */
export function buildS3ObjectKey({
  ownerType = STORAGE_OWNER_TYPES.USUARIO,
  ownerId,
  category = 'general',
  filename,
  date = new Date(),
}) {
  const { year, quarter, month, day } = getStorageDateSegments(date);
  const owner = buildOwnerSegment(ownerType, ownerId);
  const cat = sanitizeStorageSegment(category, 'general');
  const safeName = sanitizeStorageSegment(filename, `archivo-${Date.now()}`);

  const parts = [year, quarter, month, day, owner, cat, safeName];
  const key = parts.join('/');

  const prefix = storageConfig.keyPrefix();
  return prefix ? `${prefix}/${key}` : key;
}

/**
 * Prefijos para borrado masivo (mantenimiento).
 * - deleteYear: 2026/
 * - deleteQuarter: 2026/2/
 * - deleteMonth: 2026/2/06/
 * - deleteDay: 2026/2/06/05/
 * - deleteOwner: 2026/2/06/05/usuarios/abc123/
 */
export function buildMaintenancePrefix({ year, quarter, month, day, ownerType, ownerId, category }) {
  const segments = [];
  const prefix = storageConfig.keyPrefix();
  if (prefix) segments.push(prefix);

  if (year) segments.push(sanitizeStorageSegment(year));
  if (quarter) segments.push(sanitizeStorageSegment(quarter));
  if (month) segments.push(sanitizeStorageSegment(month));
  if (day) segments.push(sanitizeStorageSegment(day));
  if (ownerType && ownerId) {
    segments.push(buildOwnerSegment(ownerType, ownerId));
  }
  if (category) segments.push(sanitizeStorageSegment(category));

  const joined = segments.join('/');
  return joined.endsWith('/') ? joined : `${joined}/`;
}

/**
 * Convierte referencias internas (s3:legacy/uploads/...) a ruta local /uploads/...
 * para servir o borrar archivos que aún están en disco.
 */
export function toLocalUploadPathFromStoredRef(storedPath) {
  if (!storedPath || typeof storedPath !== 'string') return null;
  const trimmed = storedPath.trim();

  if (trimmed.startsWith('s3:legacy/')) {
    const rest = trimmed.slice('s3:legacy/'.length).replace(/^\/+/, '');
    return rest.startsWith('uploads/') ? `/${rest}` : `/uploads/${rest}`;
  }
  if (trimmed.startsWith('s3:uploads/')) {
    return `/${trimmed.slice('s3:'.length)}`;
  }
  if (trimmed.startsWith('/uploads/')) return trimmed;
  if (trimmed.startsWith('uploads/')) return `/${trimmed}`;
  return null;
}

/**
 * Variantes de clave S3 a probar (migración legacy, prefijo de bucket, etc.).
 */
export function resolveS3KeyCandidates(storedPath) {
  const primary = parseS3KeyFromStoredPath(storedPath);
  if (!primary) return [];

  const candidates = [];
  const push = (key) => {
    const k = String(key || '').replace(/^\/+/, '');
    if (k && !candidates.includes(k)) candidates.push(k);
  };

  push(primary);

  const prefix = storageConfig.keyPrefix();
  if (prefix) {
    push(`${prefix}/${primary}`);
    if (primary.startsWith('legacy/')) {
      push(`${prefix}/${primary.slice('legacy/'.length)}`);
    }
  }

  if (primary.startsWith('legacy/')) {
    push(primary.slice('legacy/'.length));
  } else if (primary.startsWith('uploads/')) {
    push(`legacy/${primary}`);
  }

  return candidates;
}

export function parseS3KeyFromStoredPath(storedPath) {
  if (!storedPath || typeof storedPath !== 'string') return null;
  const trimmed = storedPath.trim();
  if (trimmed.startsWith('s3://')) {
    const withoutScheme = trimmed.slice('s3://'.length);
    const slash = withoutScheme.indexOf('/');
    if (slash === -1) return null;
    return withoutScheme.slice(slash + 1);
  }
  if (trimmed.startsWith('s3:')) {
    return trimmed.slice('s3:'.length).replace(/^\/+/, '');
  }
  const publicBase = storageConfig.publicBaseUrl();
  if (publicBase && trimmed.startsWith(`${publicBase}/`)) {
    const raw = trimmed.slice(publicBase.length).replace(/^\//, '');
    return raw
      .split('/')
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join('/');
  }
  return null;
}

export function extensionFromOriginalName(originalName, fallback = '') {
  const ext = path.extname(originalName || '');
  return ext || fallback;
}

/**
 * Resuelve dueño desde request Express (usuario autenticado o cliente explícito).
 */
export function resolveOwnerFromRequest(req, overrides = {}) {
  if (overrides.ownerType === STORAGE_OWNER_TYPES.CLIENTE && overrides.ownerId) {
    return { ownerType: STORAGE_OWNER_TYPES.CLIENTE, ownerId: overrides.ownerId };
  }

  if (overrides.ownerId) {
    return {
      ownerType: STORAGE_OWNER_TYPES.USUARIO,
      ownerId: String(overrides.ownerId),
    };
  }

  const auth = extractAuthFromRequest(req);
  const ownerLabel = resolveOwnerLabel(auth);

  return {
    ownerType: STORAGE_OWNER_TYPES.USUARIO,
    ownerId: ownerLabel ? String(ownerLabel) : 'general',
  };
}
