import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/secrets.js';
import {
  APIS_MODULO_CONTRATISTA,
  CONTRATISTAS_MODULO,
  normalizarRol,
} from '../config/roles.js';

/**
 * Restricción de contratistas: solo se bloquean APIs de *módulos* ajenos.
 * Todo lo demás (storage, borradores, catálogos, historial, auth, etc.)
 * funciona igual que un usuario normal — evita 403 por whitelist incompleta.
 */
function coincidePrefijo(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function restringirContractorZurich(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return next();

  let payload = null;
  try {
    payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch {
    return next();
  }

  if (payload && !req.user) {
    req.user = payload;
    req.usuario = payload;
  }

  const config = CONTRATISTAS_MODULO[normalizarRol(payload?.role)];
  if (!config) return next();

  const path = String(req.originalUrl || req.url || '').split('?')[0];
  const esApiDeModulo = APIS_MODULO_CONTRATISTA.some((p) => coincidePrefijo(path, p));

  // Plataforma (subir/descargar archivos, borradores, catálogos, etc.): igual que usuario normal.
  if (!esApiDeModulo) return next();

  const moduloPermitido = (config.apis || []).some((p) => coincidePrefijo(path, p));
  if (!moduloPermitido) {
    return res.status(403).json({ error: config.mensaje });
  }

  // Rol bandeja Equidad FDM: solo lectura en su API de módulo.
  if (
    config.soloLecturaApi &&
    !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())
  ) {
    return res.status(403).json({ error: config.mensaje });
  }

  return next();
}
