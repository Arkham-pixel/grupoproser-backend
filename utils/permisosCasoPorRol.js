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

/** Alfa: ocultan del reporte/mapa los casos con fecha de llamada (Leyna Alfonso). */
export const ALFA_LOGINS_COLA_FECHA_LLAMADA = Object.freeze(['1098662033']);

const COLLATION_PERSONA = Object.freeze({ locale: 'es', strength: 1 });

function normalizarClaveDocumentoLogin(valor) {
  const s = String(valor || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  return digits.length >= 5 ? digits : s.toLowerCase();
}

function normalizarClaveLoginSura(valor) {
  return normalizarClaveDocumentoLogin(valor);
}

export function esLoginConPermisoLiderSura(login, modulo = '') {
  if (String(modulo || '').toLowerCase() !== 'sura') return false;
  const clave = normalizarClaveLoginSura(login);
  if (!clave) return false;
  return SURA_LOGINS_PERMISO_LIDER.map(normalizarClaveLoginSura).includes(clave);
}

export function esLoginColaFechaLlamadaAlfa(login) {
  const clave = normalizarClaveDocumentoLogin(login);
  if (!clave) return false;
  return ALFA_LOGINS_COLA_FECHA_LLAMADA.map(normalizarClaveDocumentoLogin).includes(clave);
}

export function esIdentidadColaFechaLlamadaAlfa(opts = {}) {
  return [opts.login, opts.cedula].some((v) => esLoginColaFechaLlamadaAlfa(v));
}

/** Login o cédula (Mario puede venir por cualquiera de los dos). */
export function esIdentidadConPermisoLiderSura(opts = {}) {
  const modulo = opts.modulo || '';
  return [opts.login, opts.cedula].some((v) => esLoginConPermisoLiderSura(v, modulo));
}

/**
 * @param {string} rol
 * @param {{ modulo?: string, login?: string, cedula?: string }} [opts]
 */
export function puedeEditarTodoElCaso(rol, opts = {}) {
  const r = normalizarRol(rol);
  if (['admin', 'soporte', ROL_AJUSTADOR_LIDER].includes(r)) return true;
  if (esIdentidadConPermisoLiderSura(opts)) return true;
  if (r === ROL_AJUSTADOR_CASO || r === ROL_INSPECTOR) return false;
  return true;
}

/**
 * Ajustador e inspector solo ven casos que el líder les asignó.
 * En SURA, Mario (72288319) ve todos.
 */
export function rolConVistaRestringidaAsignacion(rol, opts = {}) {
  if (esIdentidadConPermisoLiderSura(opts)) return false;
  const r = normalizarRol(rol);
  return r === ROL_AJUSTADOR_CASO || r === ROL_INSPECTOR;
}

export function normalizarClavePersona(valor) {
  return String(valor ?? '')
    .replace(/\s*\([^)]*\)/g, ' ')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function tokensPersona(valor) {
  return normalizarClavePersona(valor)
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length >= 4);
}

export function coincidenPersonas(a, b) {
  const na = normalizarClavePersona(a);
  const nb = normalizarClavePersona(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const tokA = tokensPersona(na);
  const tokB = tokensPersona(nb);
  if (!tokA.length || !tokB.length) return false;
  const setB = new Set(tokB);
  return tokA.filter((t) => setB.has(t)).length >= 2;
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
  let rol = normalizarRol(payload.role || payload.rol);
  let name = String(payload.name || '').trim();
  let login = String(payload.login || '').trim();
  let cedula = String(payload.cedula || '').trim();
  const userId = payload.id || payload._id || null;
  // El JWT no trae name; para match con catálogo catastrófico hay que leer SecurUser.
  if (userId) {
    try {
      const u = await SecurUser.findById(userId).select('name login role cedula').lean();
      if (u) {
        if (u.name) name = String(u.name).trim();
        if (u.login) login = String(u.login).trim();
        if (u.cedula) cedula = String(u.cedula).trim();
        if (u.role) rol = normalizarRol(u.role);
      }
    } catch {
      // sin perfil completo
    }
  }
  return { rol, name, login, cedula, id: userId };
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
  if (
    !rolConVistaRestringidaAsignacion(identidad.rol, {
      login: identidad.login,
      cedula: identidad.cedula,
      modulo,
    })
  ) {
    return null;
  }
  const campo = identidad.rol === ROL_INSPECTOR ? 'inspector' : 'ajustador';
  const claves = [
    ...new Set(
      [identidad.name, identidad.login, identidad.cedula]
        .map((s) => String(s || '').trim())
        .filter(Boolean)
    ),
  ];
  if (!claves.length) {
    return { _id: { $exists: false } };
  }
  return {
    $or: claves.flatMap((k) => ramasFiltroCampoPersona(campo, k)),
  };
}

function ramasFiltroCampoPersona(campo, valor) {
  const ramas = [
    { [campo]: valor },
    { [campo]: new RegExp(`^${escapeRegex(valor)}$`, 'i') },
  ];
  const toks = tokensPersona(valor);
  if (toks.length >= 2) {
    for (let i = 1; i < toks.length; i += 1) {
      ramas.push({
        $and: [
          { [campo]: new RegExp(escapeRegex(toks[0]), 'i') },
          { [campo]: new RegExp(escapeRegex(toks[i]), 'i') },
        ],
      });
    }
  }
  return ramas;
}

export function casoVisibleParaIdentidad(caso, identidad, opts = {}) {
  if (!identidad) return true;
  const modulo = opts.modulo || identidad.modulo || '';
  if (
    !rolConVistaRestringidaAsignacion(identidad.rol, {
      login: identidad.login,
      cedula: identidad.cedula,
      modulo,
    })
  ) {
    return true;
  }
  const campo = identidad.rol === ROL_INSPECTOR ? 'inspector' : 'ajustador';
  const valor = caso?.[campo];
  const claves = [identidad.name, identidad.login, identidad.cedula].filter(Boolean);
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
  const rol = req?.user?.role || req?.usuario?.role || req?.user?.rol || req?.usuario?.rol || null;
  const login =
    opts.login ||
    req?.user?.login ||
    req?.usuario?.login ||
    null;
  const cedula =
    opts.cedula ||
    req?.user?.cedula ||
    req?.usuario?.cedula ||
    null;
  const { payload, soloEstado } = filtrarPayloadCasoPorRol(rol, data, base, {
    modulo: opts.modulo,
    login,
    cedula,
  });
  return { data: payload, soloEstado, rol };
}
