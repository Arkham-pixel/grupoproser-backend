/**
 * Portal Facilitadores SURA: solo Oscar Atencia, Bernardo Sojo y Ligia García.
 */
import { obtenerIdentidadUsuarioReq } from '../utils/permisosCasoPorRol.js';

export const SURA_LOGINS_FACILITADORES = Object.freeze([
  '1065012991',
  '72134505',
  '66901947',
]);

function claveLogin(valor) {
  const s = String(valor || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  return digits.length >= 5 ? digits : s.toLowerCase();
}

export function esUsuarioFacilitadoresSura(user = {}) {
  const claves = [user.login, user.cedula, user.documento]
    .map(claveLogin)
    .filter(Boolean);
  const permitidos = SURA_LOGINS_FACILITADORES.map(claveLogin);
  return claves.some((k) => permitidos.includes(k));
}

/** Requiere token + login autorizado (resuelve login/cédula desde BD si hace falta). */
export async function verificarAccesoFacilitadoresSura(req, res, next) {
  try {
    const identidad = await obtenerIdentidadUsuarioReq(req);
    const u = {
      login: identidad?.login || req.usuario?.login || req.user?.login,
      cedula: identidad?.cedula || req.usuario?.cedula || req.user?.cedula,
      documento: req.usuario?.documento || req.user?.documento,
    };
    if (esUsuarioFacilitadoresSura(u)) {
      return next();
    }
    return res.status(403).json({
      success: false,
      error: 'No autorizado para el Portal de Facilitadores SURA.',
      code: 'SURA_FACILITADORES_FORBIDDEN',
    });
  } catch {
    return res.status(403).json({
      success: false,
      error: 'No autorizado para el Portal de Facilitadores SURA.',
      code: 'SURA_FACILITADORES_FORBIDDEN',
    });
  }
}
