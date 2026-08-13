import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/secrets.js';
import { normalizarRol } from '../config/roles.js';

/**
 * Contractor Zurich solo puede usar APIs del módulo Zurich (y sesión/perfil).
 */
const PREFIJOS_PERMITIDOS = [
  '/api/zurich',
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
  if (normalizarRol(payload?.role) !== 'contractor_zurich') return next();

  const path = String(req.originalUrl || req.url || '').split('?')[0];
  const permitido =
    PREFIJOS_PERMITIDOS.some((p) => path.startsWith(p)) ||
    (req.method === 'GET' && PREFIJOS_SOLO_LECTURA.some((p) => path.startsWith(p)));
  if (!permitido) {
    return res.status(403).json({
      error: 'Su rol Contractor Zurich solo permite trabajar el módulo Zurich.',
    });
  }
  return next();
}
