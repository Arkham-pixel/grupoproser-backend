import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/secrets.js';

/**
 * Los JWT con rol "externo" (sesión emitida desde el enlace de subtarea) solo
 * pueden usar las APIs que necesita el formulario de ajuste. Cualquier otra
 * ruta con ese token se rechaza, aunque la firma sea válida.
 */
const PREFIJOS_PERMITIDOS_EXTERNO = [
  '/api/historial-formularios',
  '/api/complex-subtareas/public',
  '/api/complex/',
  '/api/storage',
  '/api/secur-auth/logout',
  '/uploads',
];

// Solo lectura: catálogos que el formulario de ajuste necesita (p. ej. firmas)
const PREFIJOS_SOLO_LECTURA_EXTERNO = ['/api/funcionarios'];

export function restringirExterno(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return next();

  let payload = null;
  try {
    payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch {
    // Token inválido/expirado: que lo rechace el middleware de la ruta
    return next();
  }
  if (!payload?.externo) return next();

  const path = String(req.path || req.url || '');
  const permitido =
    PREFIJOS_PERMITIDOS_EXTERNO.some((p) => path.startsWith(p)) ||
    (req.method === 'GET' && PREFIJOS_SOLO_LECTURA_EXTERNO.some((p) => path.startsWith(p)));
  if (!permitido) {
    return res.status(403).json({
      error: 'Su acceso externo solo permite trabajar el formulario de ajuste asignado.',
    });
  }
  return next();
}
