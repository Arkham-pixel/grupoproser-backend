/**
 * Permisos de update / vista de casos por rol (espejo del frontend).
 *
 * Excepción SURA: login 72288319 (Mario Pinilla) = poderes de líder solo en SURA.
 * Excepción agenda CAT: login 1130615470 ve todos los calendarios generales como admin.
 */
import { esRolEra, normalizarRol } from '../config/roles.js';
import SecurUser from '../models/SecurUser.js';
import { identidadEsLiderDeFuente } from './lideresModuloCatastrofico.js';
import { esIdentidadEra, esIdentidadLiderEra } from './jerarquiaEra.js';

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

/** Logins que ven toda la agenda CAT (todos los módulos), como admin/soporte. */
export const AGENDA_LOGINS_VISTA_GLOBAL = Object.freeze(['1130615470']);

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

export function esLoginConVistaGlobalAgenda(login) {
  const clave = normalizarClaveDocumentoLogin(login);
  if (!clave) return false;
  return AGENDA_LOGINS_VISTA_GLOBAL.map(normalizarClaveDocumentoLogin).includes(clave);
}

/** Login o cédula: ve todos los calendarios generales CAT, sin ser admin. */
export function esIdentidadConVistaGlobalAgenda(opts = {}) {
  return [opts.login, opts.cedula].some((v) => esLoginConVistaGlobalAgenda(v));
}

/** Login o cédula (Mario puede venir por cualquiera de los dos). */
export function esIdentidadConPermisoLiderSura(opts = {}) {
  const modulo = opts.modulo || '';
  return [opts.login, opts.cedula].some((v) => esLoginConPermisoLiderSura(v, modulo));
}

export function esIdentidadLiderDeModulo(identidad = {}, modulo = '') {
  if (esIdentidadConPermisoLiderSura({ ...identidad, modulo })) return true;
  return identidadEsLiderDeFuente(identidad, modulo);
}

/**
 * @param {string} rol
 * @param {{ modulo?: string, login?: string, cedula?: string }} [opts]
 */
export function puedeEditarTodoElCaso(rol, opts = {}) {
  const r = normalizarRol(rol);
  if (['admin', 'soporte'].includes(r)) return true;
  if (esIdentidadLiderDeModulo(opts, opts.modulo)) return true;
  if (r === ROL_AJUSTADOR_LIDER && !opts.modulo) return true;
  if (esIdentidadConPermisoLiderSura(opts)) return true;
  if (esRolEra(r) || esIdentidadEra(opts)) {
    return esIdentidadLiderEra({ ...opts, rol: r });
  }
  if (r === ROL_AJUSTADOR_CASO || r === ROL_INSPECTOR) return false;
  return true;
}

/**
 * Ajustador e inspector solo ven casos que el líder les asignó.
 * El líder de área ve todo su módulo. En SURA, Mario (72288319) ve todos.
 */
export function rolConVistaRestringidaAsignacion(rol, opts = {}) {
  if (esIdentidadLiderDeModulo(opts, opts.modulo)) return false;
  const r = normalizarRol(rol);
  if (['admin', 'soporte'].includes(r)) return false;
  if (esRolEra(r) || esIdentidadEra({ ...opts, rol: r })) return true;
  if (!opts.modulo && r === ROL_AJUSTADOR_LIDER) return false;
  return r === ROL_AJUSTADOR_CASO || r === ROL_INSPECTOR || r === ROL_AJUSTADOR_LIDER;
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

/** Exacto o misma raíz (Campo/Campos; acentos ya salen en normalizarClavePersona). */
function tokensPersonaCoinciden(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}

export function coincidenPersonas(a, b) {
  const na = normalizarClavePersona(a);
  const nb = normalizarClavePersona(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const tokA = tokensPersona(na);
  const tokB = tokensPersona(nb);
  if (!tokA.length || !tokB.length) return false;
  const comunes = tokA.filter((t) => tokB.some((u) => tokensPersonaCoinciden(t, u)));
  return comunes.length >= 2;
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
  let empresa = String(payload.empresa || '').trim();
  const userId = payload.id || payload._id || null;
  // El JWT no trae name; para match con catálogo catastrófico hay que leer SecurUser.
  if (userId) {
    try {
      const u = await SecurUser.findById(userId).select('name login role cedula empresa').lean();
      if (u) {
        if (u.name) name = String(u.name).trim();
        if (u.login) login = String(u.login).trim();
        if (u.cedula) cedula = String(u.cedula).trim();
        if (u.role) rol = normalizarRol(u.role);
        empresa = String(u.empresa || '').trim();
      }
    } catch {
      // sin perfil completo
    }
  }
  return { rol, name, login, cedula, empresa, id: userId };
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
      name: identidad.name,
      nombre: identidad.nombre || identidad.name,
      modulo,
    })
  ) {
    return null;
  }
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
    $or: claves.flatMap((k) => [
      ...ramasFiltroCampoPersona('ajustador', k),
      ...ramasFiltroCampoPersona('inspector', k),
    ]),
  };
}

export function ramasFiltroCampoPersona(campo, valor) {
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

export function clavesIdentidadVista(identidad = {}) {
  return [...new Set(
    [identidad.name, identidad.nombre, identidad.login, identidad.cedula]
      .map((s) => String(s || '').trim())
      .filter(Boolean)
  )];
}

/**
 * ERA: sin lista de la firma, fallback conservador (asignado a la sesión o sello ERA).
 * El listado Alfa usa `construirFiltroVistaCasos` (pool completo de la firma).
 */
export function modoEdicionEraDelCaso(caso = {}, identidad = {}) {
  if (!esIdentidadEra(identidad) && !esRolEra(identidad.rol || identidad.role)) return null;
  if (esIdentidadLiderEra(identidad)) return 'lider';
  const claves = clavesIdentidadVista(identidad);
  if (!claves.length) return null;
  if (claves.some((k) => coincidenPersonas(caso?.ajustador, k))) return 'ajustador';
  if (claves.some((k) => coincidenPersonas(caso?.inspector, k))) return 'inspector';
  return null;
}

export function casoVisibleParaIdentidad(caso, identidad, opts = {}) {
  if (!identidad) return true;
  const modulo = opts.modulo || identidad.modulo || '';
  const identidadVista = {
    login: identidad.login,
    cedula: identidad.cedula,
    name: identidad.name,
    nombre: identidad.nombre || identidad.name,
    rol: identidad.rol,
    empresa: identidad.empresa,
    modulo,
  };
  if (esIdentidadEra(identidadVista) || esRolEra(identidad.rol)) {
    if (String(caso?.firmaAjuste || '').trim().toUpperCase() === 'ERA') return true;
    const claves = clavesIdentidadVista(identidadVista);
    if (!claves.length) return false;
    if (esIdentidadLiderEra(identidadVista)) {
      return claves.some(
        (k) =>
          coincidenPersonas(caso?.ajustador, k) ||
          coincidenPersonas(caso?.inspector, k) ||
          coincidenPersonas(caso?.ajustadorLider, k)
      );
    }
    return claves.some(
      (k) => coincidenPersonas(caso?.ajustador, k) || coincidenPersonas(caso?.inspector, k)
    );
  }
  if (!rolConVistaRestringidaAsignacion(identidad.rol, identidadVista)) {
    return true;
  }
  const claves = clavesIdentidadVista(identidadVista);
  if (!claves.length) return false;
  return claves.some(
    (k) => coincidenPersonas(caso?.ajustador, k) || coincidenPersonas(caso?.inspector, k)
  );
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
function payloadSoloEstado(payload = {}, base = {}) {
  return {
    payload: {
      estado: payload.estado != null ? payload.estado : base.estado,
    },
    soloEstado: true,
  };
}

function payloadSinAsignacion(payload = {}, base = {}) {
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

export function filtrarPayloadCasoPorRol(rol, payload = {}, base = {}, opts = {}) {
  if (!rol) return { payload: { ...payload }, soloEstado: false };
  const r = normalizarRol(rol);
  const identidad = { ...opts, rol: r };
  if (puedeEditarTodoElCaso(r, identidad)) {
    return { payload: { ...payload }, soloEstado: false };
  }
  if (esRolEra(r) || esIdentidadEra(identidad)) {
    const modo = modoEdicionEraDelCaso(opts.caso || base, identidad);
    if (modo === 'inspector') return payloadSoloEstado(payload, base);
    if (modo === 'ajustador') return payloadSinAsignacion(payload, base);
    return { payload: {}, soloEstado: false, denegado: true };
  }
  if (r === ROL_INSPECTOR) {
    return payloadSoloEstado(payload, base);
  }
  if (r === ROL_AJUSTADOR_CASO) {
    return payloadSinAsignacion(payload, base);
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
  const { payload, soloEstado, denegado } = filtrarPayloadCasoPorRol(rol, data, base, {
    modulo: opts.modulo,
    login,
    cedula,
    name: opts.name || req?.user?.name || req?.usuario?.name || null,
    nombre: opts.nombre || req?.user?.name || req?.usuario?.name || null,
    empresa: opts.empresa || req?.user?.empresa || req?.usuario?.empresa || null,
    caso: opts.caso || base,
  });
  return { data: payload, soloEstado, rol, denegado: Boolean(denegado) };
}
