/**
 * Permisos de update / vista de casos por rol (espejo del frontend).
 *
 * Excepción SURA: login 72288319 (Mario Pinilla) = poderes de líder solo en SURA.
 */
import { normalizarRol } from '../config/roles.js';
import SecurUser from '../models/SecurUser.js';

export const ROL_AJUSTADOR_LIDER = 'ajustador_lider';
export const ROL_AJUSTADOR_CASO = 'ajustador';
export const ROL_INSPECTOR = 'inspector';

export const CAMPOS_ASIGNACION_CASO = Object.freeze([
  'ajustadorLider',
  'ajustador',
  'inspector',
]);

/** Logins con poderes de ajustador líder SOLO en módulo SURA. */
export const SURA_LOGINS_PERMISO_LIDER = Object.freeze(['72288319']);

const COLLATION_PERSONA = Object.freeze({ locale: 'es', strength: 1 });

export function esLoginConPermisoLiderSura(login, modulo = '') {
  if (String(modulo || '').toLowerCase() !== 'sura') return false;
  const l = String(login || '').trim();
  if (!l) return false;
  return SURA_LOGINS_PERMISO_LIDER.includes(l);
}

/**
 * @param {string} rol
 * @param {{ modulo?: string, login?: string }} [opts]
 */
export function puedeEditarTodoElCaso(rol, opts = {}) {
  const r = normalizarRol(rol);
  if (['admin', 'soporte', ROL_AJUSTADOR_LIDER].includes(r)) return true;
  if (esLoginConPermisoLiderSura(opts.login, opts.modulo)) return true;
  if (r === ROL_AJUSTADOR_CASO || r === ROL_INSPECTOR) return false;
  return true;
}

/**
 * Ajustador e inspector solo ven casos que el líder les asignó.
 * En SURA, Mario (72288319) ve todos.
 */
export function rolConVistaRestringidaAsignacion(rol, opts = {}) {
  if (esLoginConPermisoLiderSura(opts.login, opts.modulo)) return false;
  const r = normalizarRol(rol);
  return r === ROL_AJUSTADOR_CASO || r === ROL_INSPECTOR;
}

export function normalizarClavePersona(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function coincidenPersonas(a, b) {
  const na = normalizarClavePersona(a);
  const nb = normalizarClavePersona(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function escapeRegex(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resuelve rol + name + login desde JWT (completa name desde SecurUser si falta).
 */
export async function obtenerIdentidadUsuarioReq(req) {
  const payload = req?.user || req?.usuario || null;
  if (!payload) return null;
  const rol = normalizarRol(payload.role);
  let name = String(payload.name || '').trim();
  let login = String(payload.login || '').trim();
  // El JWT no trae name; para match con catálogo catastrófico hay que leer SecurUser.
  if (payload.id) {
    try {
      const u = await SecurUser.findById(payload.id).select('name login role').lean();
      if (u) {
        if (u.name) name = String(u.name).trim();
        if (u.login) login = String(u.login).trim();
      }
    } catch {
      // sin perfil completo
    }
  }
  return { rol, name, login, id: payload.id || null };
}

/**
 * Filtro Mongo para listados. null = sin restricción.
 * Sin claves de identidad → filtro imposible (no ve nada).
 * @param {{ rol: string, name?: string, login?: string } | null} identidad
 * @param {{ modulo?: string }} [opts]
 */
export function construirFiltroVistaAsignacion(identidad, opts = {}) {
  if (!identidad) return null;
  const modulo = opts.modulo || identidad.modulo || '';
  if (!rolConVistaRestringidaAsignacion(identidad.rol, { login: identidad.login, modulo })) {
    return null;
  }
  const campo = identidad.rol === ROL_INSPECTOR ? 'inspector' : 'ajustador';
  const claves = [...new Set([identidad.name, identidad.login].map((s) => String(s || '').trim()).filter(Boolean))];
  if (!claves.length) {
    return { _id: { $exists: false } };
  }
  return {
    $or: claves.flatMap((k) => [
      { [campo]: k },
      { [campo]: new RegExp(`^${escapeRegex(k)}$`, 'i') },
    ]),
  };
}

export function casoVisibleParaIdentidad(caso, identidad, opts = {}) {
  if (!identidad) return true;
  const modulo = opts.modulo || identidad.modulo || '';
  if (!rolConVistaRestringidaAsignacion(identidad.rol, { login: identidad.login, modulo })) {
    return true;
  }
  const campo = identidad.rol === ROL_INSPECTOR ? 'inspector' : 'ajustador';
  const valor = caso?.[campo];
  const claves = [identidad.name, identidad.login].filter(Boolean);
  if (!claves.length) return false;
  return claves.some((k) => coincidenPersonas(valor, k));
}

export function collationVistaAsignacion() {
  return COLLATION_PERSONA;
}

export function combinarFiltrosMongo(...partes) {
  const validos = partes.filter((p) => p && typeof p === 'object' && Object.keys(p).length > 0);
  if (!validos.length) return {};
  if (validos.length === 1) return validos[0];
  return { $and: validos };
}

/**
 * Filtra body de actualización según rol del usuario autenticado.
 * Si no hay rol (ruta sin token), no restringe (compat).
 */
export function filtrarPayloadCasoPorRol(rol, payload = {}, base = {}, opts = {}) {
  if (!rol) return { payload: { ...payload }, soloEstado: false };
  const r = normalizarRol(rol);
  if (puedeEditarTodoElCaso(r, opts)) {
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
export function aplicarRestriccionRolCaso(req, data, base = {}, opts = {}) {
  const rol = req?.user?.role || req?.usuario?.role || null;
  const login =
    opts.login ||
    req?.user?.login ||
    req?.usuario?.login ||
    null;
  const { payload, soloEstado } = filtrarPayloadCasoPorRol(rol, data, base, {
    modulo: opts.modulo,
    login,
  });
  return { data: payload, soloEstado, rol };
}
