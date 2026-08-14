import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/secrets.js';
import { CONTRATISTAS_MODULO, normalizarRol } from '../config/roles.js';

const PREFIJOS_COMUNES = [
  '/api/storage',
  '/api/health',
  '/api/secur-auth',
  '/uploads',
];

const PREFIJOS_SOLO_LECTURA = ['/api/ciudades', '/api/responsables'];

export function restringirContractorZurich(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return next();

  let payload = null;
  try {
    payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch {
    return next();
  }

  const config = CONTRATISTAS_MODULO[normalizarRol(payload?.role)];
  if (!config) return next();

  const path = String(req.originalUrl || req.url || '').split('?')[0];
  const permitido =
    [...PREFIJOS_COMUNES, ...config.apis].some((p) => path.startsWith(p)) ||
    (req.method === 'GET' && PREFIJOS_SOLO_LECTURA.some((p) => path.startsWith(p)));
  if (!permitido) {
    return res.status(403).json({ error: config.mensaje });
  }
  return next();
}
