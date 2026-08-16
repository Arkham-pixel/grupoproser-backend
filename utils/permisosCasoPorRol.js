/**
 * Permisos de update de casos por rol (espejo del frontend).
 */
import { normalizarRol } from '../config/roles.js';

export const ROL_AJUSTADOR_LIDER = 'ajustador_lider';
export const ROL_AJUSTADOR_CASO = 'ajustador';
export const ROL_INSPECTOR = 'inspector';

export const CAMPOS_ASIGNACION_CASO = Object.freeze([
  'ajustadorLider',
  'ajustador',
  'inspector',
]);

export function puedeEditarTodoElCaso(rol) {
  const r = normalizarRol(rol);
  if (['admin', 'soporte', ROL_AJUSTADOR_LIDER].includes(r)) return true;
  if (r === ROL_AJUSTADOR_CASO || r === ROL_INSPECTOR) return false;
  return true;
}

/**
 * Filtra body de actualización según rol del usuario autenticado.
 * Si no hay rol (ruta sin token), no restringe (compat).
 */
export function filtrarPayloadCasoPorRol(rol, payload = {}, base = {}) {
  if (!rol) return { payload: { ...payload }, soloEstado: false };
  const r = normalizarRol(rol);
  if (puedeEditarTodoElCaso(r)) {
    return { payload: { ...payload }, soloEstado: false };
  }
  if (r === ROL_INSPECTOR) {
    return {
      payload: {
        estado: payload.estado != null ? payload.estado : base.estado,
      },
      soloEstado: true,
    };
  }
  if (r === ROL_AJUSTADOR_CASO) {
    const next = { ...payload };
    for (const campo of CAMPOS_ASIGNACION_CASO) {
      if (Object.prototype.hasOwnProperty.call(base, campo)) {
        next[campo] = base[campo];
      } else {
        delete next[campo];
      }
    }
    return { payload: next, soloEstado: false };
  }
  return { payload: { ...payload }, soloEstado: false };
}

/** Aplica filtro sobre data cruda antes de buildPayload. */
export function aplicarRestriccionRolCaso(req, data, base = {}) {
  const rol = req?.user?.role || req?.usuario?.role || null;
  const { payload, soloEstado } = filtrarPayloadCasoPorRol(rol, data, base);
  return { data: payload, soloEstado, rol };
}
