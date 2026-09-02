import { coincidenPersonas, SURA_LOGINS_PERMISO_LIDER } from './permisosCasoPorRol.js';
import { quitarSufijosRolDelNombre } from '../config/roles.js';
import { needlesLiderModulo as needlesLiderDesdeArea } from './lideresModuloCatastrofico.js';
import {
  usuarioEsLiderEra,
  usuarioEsLiderProserAjustes,
} from './jerarquiaEra.js';

export const ROLES_NOTIFICACION = Object.freeze(['ajustador_lider', 'ajustador', 'inspector']);

const PLACEHOLDER_ASIGNACION =
  /^(PENDIENTE|N A|NA|SIN ASIGNAR|POR CONFIRMAR|-|PROSER|PROSERAJUSTES|PROSER AJUSTES|GRUPO PROSER|PROSER PUERTOS)$/;

export const MODULOS_NOTIFICACION = Object.freeze({
  equidadCat: {
    etiqueta: 'Equidad CAT',
    rutaCaso: (id) => `/equidad-cat/reporte?casoId=${id}`,
    rutaLista: '/equidad-cat/reporte',
  },
  alfa: {
    etiqueta: 'Alfa',
    rutaCaso: (id) => `/seguros-alfa/reporte?casoId=${id}`,
    rutaLista: '/seguros-alfa/reporte',
  },
  sura: {
    etiqueta: 'SURA',
    rutaCaso: (id) => `/sura/reporte?casoId=${id}`,
    rutaLista: '/sura/reporte',
  },
  zurich: {
    etiqueta: 'Zurich',
    rutaCaso: (id) => `/zurich/reporte?casoId=${id}`,
    rutaLista: '/zurich/reporte',
  },
  zurichListado: {
    etiqueta: 'Zurich (listado)',
    rutaCaso: (id) => `/zurich/listado/reporte?casoId=${id}`,
    rutaLista: '/zurich/listado/reporte',
  },
  bbvaCat: {
    etiqueta: 'BBVA CAT',
    rutaCaso: (id) => `/bbva-cat/reporte?casoId=${id}`,
    rutaLista: '/bbva-cat/reporte',
  },
  bbvaCatListado: {
    etiqueta: 'BBVA CAT (listado)',
    rutaCaso: (id) => `/bbva-cat/listado/reporte?casoId=${id}`,
    rutaLista: '/bbva-cat/listado/reporte',
  },
  allianz: {
    etiqueta: 'Allianz',
    rutaCaso: (id) => `/allianz/reporte?casoId=${id}`,
    rutaLista: '/allianz/reporte',
  },
  allianzListado: {
    etiqueta: 'Allianz (listado)',
    rutaCaso: (id) => `/allianz/listado/reporte?casoId=${id}`,
    rutaLista: '/allianz/listado/reporte',
  },
  previsora: {
    etiqueta: 'Previsora',
    rutaCaso: (id) => `/previsora/reporte?casoId=${id}`,
    rutaLista: '/previsora/reporte',
  },
  previsoraListado: {
    etiqueta: 'Previsora (listado)',
    rutaCaso: (id) => `/previsora/listado/reporte?casoId=${id}`,
    rutaLista: '/previsora/listado/reporte',
  },
});

export function claveModuloNotificacion(modulo = '') {
  return String(modulo || '')
    .toLowerCase()
    .replace(/[-_\s]/g, '');
}

export function configModuloNotificacion(modulo = '') {
  const c = claveModuloNotificacion(modulo);
  if (c === 'equidadcat') return MODULOS_NOTIFICACION.equidadCat;
  if (c === 'alfa' || c === 'segurosalfa') return MODULOS_NOTIFICACION.alfa;
  if (c === 'sura' || c === 'segurossura') return MODULOS_NOTIFICACION.sura;
  if (c === 'zurichlistado') return MODULOS_NOTIFICACION.zurichListado;
  if (c === 'zurich') return MODULOS_NOTIFICACION.zurich;
  if (c === 'bbvacatlistado' || c === 'bbvalistado') return MODULOS_NOTIFICACION.bbvaCatListado;
  if (c === 'bbvacat' || c === 'bbva') return MODULOS_NOTIFICACION.bbvaCat;
  if (c === 'allianzlistado') return MODULOS_NOTIFICACION.allianzListado;
  if (c === 'allianz' || c === 'allias') return MODULOS_NOTIFICACION.allianz;
  if (c === 'previsoralistado') return MODULOS_NOTIFICACION.previsoraListado;
  if (c === 'previsora') return MODULOS_NOTIFICACION.previsora;
  return {
    etiqueta: String(modulo || 'Casos'),
    rutaCaso: (id) => `/?casoId=${id}`,
    rutaLista: '/inicio',
  };
}

export function valorAsignacionVacio(valor) {
  const n = String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) return true;
  if (PLACEHOLDER_ASIGNACION.test(n)) return true;
  return /PROSER/.test(n) && /ARNALDO/.test(n);
}

export function asignacionCambio(previo, actual) {
  const a = String(actual ?? '').trim();
  const p = String(previo ?? '').trim();
  if (valorAsignacionVacio(a)) return false;
  if (!p) return true;
  return !coincidenPersonas(p, a);
}

/** Alguien que estaba asignado ya no lo está (lo quitaron o lo cambiaron). */
export function asignacionQuitada(previo, actual) {
  if (valorAsignacionVacio(previo)) return false;
  if (valorAsignacionVacio(actual)) return true;
  return !coincidenPersonas(String(previo ?? '').trim(), String(actual ?? '').trim());
}

export function etiquetaCaso(doc = {}) {
  const consecutivo = String(doc.consecutivo || '').trim();
  const siniestro = String(doc.siniestro || doc.nmroSinstro || '').trim();
  const zc = String(doc.zc || '').trim();
  const asegurado = String(doc.asegurado || '').trim();
  if (consecutivo && siniestro) return `${consecutivo} · ${siniestro}`;
  return consecutivo || siniestro || zc || asegurado || String(doc._id || doc.id || '').trim();
}

export function resumenCasoNotificacion(doc = {}) {
  const id = String(doc._id || doc.id || '').trim();
  return {
    id,
    etiqueta: etiquetaCaso(doc),
    consecutivo: String(doc.consecutivo || '').trim(),
    siniestro: String(doc.siniestro || doc.nmroSinstro || '').trim(),
    asegurado: String(doc.asegurado || '').trim(),
  };
}

export function needlesLiderModulo(modulo = '') {
  return needlesLiderDesdeArea(modulo);
}

function esObjectIdHex(valor) {
  return /^[a-f0-9]{24}$/i.test(String(valor || '').trim());
}

function claveDocumento(valor) {
  const s = String(valor || '').trim();
  if (!s) return '';
  if (esObjectIdHex(s)) return s.toLowerCase();
  const digits = s.replace(/\D/g, '');
  return digits.length >= 5 ? digits : s.toLowerCase();
}

const PREFIJO_CODIGO = /^(AJU|INS|AJUSTADOR|INSPECTOR)[-_\s]*/i;

function agregarClaveIdentidad(set, crudo) {
  const s = String(crudo ?? '').trim();
  if (!s || s === 'undefined' || s === 'null') return;
  set.add(s.toLowerCase());
  if (esObjectIdHex(s)) return;
  const sinPrefijo = s.replace(PREFIJO_CODIGO, '').trim();
  if (sinPrefijo && sinPrefijo.toLowerCase() !== s.toLowerCase()) {
    set.add(sinPrefijo.toLowerCase());
  }
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 5 && digits.length <= 15) set.add(digits);
  if (sinPrefijo) {
    const digitsPref = sinPrefijo.replace(/\D/g, '');
    if (digitsPref.length >= 5 && digitsPref.length <= 15) set.add(digitsPref);
  }
}

/**
 * IDs con los que se cruza usuario ↔ ajustador/inspector:
 * _id Mongo, login, cédula, codigo (AJU-/INS-), usuarioId.
 */
export function clavesIdentidadPersona(persona = {}) {
  const set = new Set();
  if (persona == null || persona === '') return set;
  if (typeof persona !== 'object') {
    agregarClaveIdentidad(set, persona);
    return set;
  }
  const campos = [
    persona._id,
    persona.id,
    persona.usuarioId,
    persona.userId,
    persona.idUsuario,
    persona.login,
    persona.cedula,
    persona.codigo,
    persona.codiRespnsble,
    persona.ajustadorId,
    persona.inspectorId,
  ];
  for (const campo of campos) agregarClaveIdentidad(set, campo);
  return set;
}

export function coincidenPorId(a, b) {
  const A = clavesIdentidadPersona(a);
  const B = clavesIdentidadPersona(b);
  if (!A.size || !B.size) return false;
  for (const k of A) {
    if (B.has(k)) return true;
  }
  return false;
}

function normalizarContacto(valor) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function telefonosDe(persona = {}) {
  return [persona.phone, persona.telefono, persona.celulares, persona.telefonoFijo]
    .map((v) => String(v || '').replace(/\D/g, ''))
    .filter((d) => d.length >= 7);
}

/** Email, teléfono o nombre cuando no hay ID en común. */
export function coincidenDatoParecido(usuario, valor, item = null) {
  if (!usuario) return false;
  const emailUser = normalizarContacto(usuario.email);
  const emails = [valor, item?.email, item?.correo]
    .map(normalizarContacto)
    .filter((e) => e.includes('@'));
  if (emailUser && emails.includes(emailUser)) return true;

  const telsUser = telefonosDe(usuario);
  const telsOtro = [...telefonosDe(item || {}), ...telefonosDe({ telefono: valor })];
  if (telsUser.some((t) => telsOtro.includes(t))) return true;

  if (valor && usuarioCoincideNombre(usuario, valor)) return true;
  if (item?.nombre && usuarioCoincideNombre(usuario, item.nombre)) return true;
  return false;
}

export function usuarioCoincideNombre(usuario, nombre) {
  if (!usuario || valorAsignacionVacio(nombre)) return false;
  if (coincidenPorId(usuario, nombre)) return true;
  const nombreUsuario = quitarSufijosRolDelNombre(usuario.name || usuario.nombre || '');
  if (coincidenPersonas(nombreUsuario, nombre)) return true;
  const login = String(usuario.login || '').trim();
  const cedula = String(usuario.cedula || '').trim();
  const email = String(usuario.email || '').trim().toLowerCase();
  if (login && coincidenPersonas(login, nombre)) return true;
  if (cedula && coincidenPersonas(cedula, nombre)) return true;
  if (email && String(nombre).trim().toLowerCase() === email) return true;
  const claveNom = claveDocumento(nombre);
  if (claveNom && (claveDocumento(login) === claveNom || claveDocumento(cedula) === claveNom)) {
    return true;
  }
  const tokUser = tokensCorto(nombreUsuario);
  const tokVal = tokensCorto(nombre);
  if (
    tokUser.length &&
    tokVal.length &&
    tokUser[0] === tokVal[0] &&
    tokUser[tokUser.length - 1] === tokVal[tokVal.length - 1]
  ) {
    return true;
  }
  return false;
}

function tokensCorto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length >= 3);
}

export function usuarioCoincideCatalogo(usuario, item) {
  if (!usuario || !item) return false;
  if (coincidenPorId(usuario, item)) return true;
  return coincidenDatoParecido(usuario, item.nombre || item.codigo, item);
}

export function itemCatalogoPorValor(catalogo = [], valor) {
  if (valorAsignacionVacio(valor)) return null;
  const crudo = String(valor || '').trim();
  const probe = {
    _id: crudo,
    id: crudo,
    codigo: crudo,
    login: crudo,
    cedula: crudo,
    nombre: crudo,
    email: crudo,
  };
  return (
    catalogo.find(
      (c) =>
        coincidenPorId(c, probe) ||
        coincidenPersonas(c.nombre, crudo) ||
        usuarioCoincideNombre({ name: c.nombre, login: c.codigo, email: c.email, _id: c._id }, crudo)
    ) || null
  );
}

export function usuarioCoincideNeedle(usuario, needle) {
  const n = String(needle || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();
  if (!n) return false;
  const haystack = String(quitarSufijosRolDelNombre(usuario?.name || usuario?.nombre || ''))
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
  return haystack.includes(n);
}

export function esMismoActor(usuario, actor) {
  if (!usuario || !actor) return false;
  if (coincidenPorId(usuario, actor)) return true;
  const loginActor = String(actor.login || '').trim();
  const loginUser = String(usuario.login || '').trim();
  if (loginActor && loginUser && loginActor.toLowerCase() === loginUser.toLowerCase()) return true;
  return false;
}

export function esLoginLiderSuraExtra(usuario) {
  const claves = [usuario?.login, usuario?.cedula].map(claveDocumento).filter(Boolean);
  const extras = SURA_LOGINS_PERMISO_LIDER.map(claveDocumento);
  return claves.some((c) => extras.includes(c));
}

/**
 * Líderes a notificar por casos nuevos.
 */
export function destinatariosCasoNuevo(usuarios = [], modulo = '', caso = {}, actor = null) {
  const needles = needlesLiderModulo(modulo);
  const liderCampo = String(caso.ajustadorLider || '').trim();
  const esSura = claveModuloNotificacion(modulo).includes('sura');
  return usuarios.filter((u) => {
    if (esMismoActor(u, actor)) return false;
    if (esSura && esLoginLiderSuraExtra(u)) return true;
    if (needles.some((n) => usuarioCoincideNeedle(u, n))) return true;
    if (liderCampo && (coincidenPorId(u, liderCampo) || usuarioCoincideNombre(u, liderCampo))) {
      return true;
    }
    return false;
  });
}

/**
 * Inspector / ajustador recién asignado (desde otro usuario o autoasignación).
 */
export function destinatariosAsignacion(usuarios = [], campo, valor, actor = null, catalogo = []) {
  if (valorAsignacionVacio(valor)) return [];
  const item = itemCatalogoPorValor(catalogo, valor);
  const probeValor = {
    _id: valor,
    id: valor,
    codigo: valor,
    login: valor,
    cedula: valor,
  };
  const vistos = new Set();
  const porId = [];
  const porDato = [];
  for (const u of usuarios) {
    const id = String(u._id || u.id || u.login || '');
    if (!id || vistos.has(id)) continue;
    const matchId = coincidenPorId(u, probeValor) || (item ? coincidenPorId(u, item) : false);
    const matchDato = coincidenDatoParecido(u, valor, item);
    if (!matchId && !matchDato) continue;
    vistos.add(id);
    if (matchId) porId.push(u);
    else porDato.push(u);
  }
  if (porId.length) return porId;
  if (item?.email) {
    const email = String(item.email).trim().toLowerCase();
    const porEmail = porDato.filter((u) => String(u.email || '').trim().toLowerCase() === email);
    if (porEmail.length === 1) return porEmail;
  }
  const rolesCampo =
    campo === 'inspector' ? ['inspector'] : ['ajustador', 'ajustador_lider'];
  const porRol = porDato.filter((u) =>
    rolesCampo.includes(String(u.role || u.rol || '').toLowerCase())
  );
  if (porRol.length === 1) return porRol;
  if (porDato.length === 1) return porDato;
  if (porRol.length) return porRol;
  return porDato;
}

/**
 * Cadena ERA: todo movimiento avisa al Líder Proser Ajustes.
 * Inspector ERA → también al ajustador del caso y al Líder ERA.
 * Ajustador ERA → Líder ERA + Líder Proser.
 * Líder ERA → Líder Proser.
 */
export function destinatariosMovimientoEra(usuarios = [], caso = {}, actor = null) {
  const vistos = new Set();
  const out = [];
  const push = (u) => {
    if (!u) return;
    const id = String(u._id || u.id || u.login || '');
    if (!id || vistos.has(id)) return;
    if (esMismoActor(u, actor)) return;
    vistos.add(id);
    out.push(u);
  };
  for (const u of usuarios) {
    if (usuarioEsLiderProserAjustes(u)) push(u);
    if (usuarioEsLiderEra(u)) push(u);
  }
  const actorNombre = actor?.name || actor?.nombre || actor?.login || '';
  const actorEsInspectorCaso =
    Boolean(actorNombre) &&
    coincidenPersonas(caso?.inspector, actorNombre) &&
    !coincidenPersonas(caso?.ajustador, actorNombre);
  if (actorEsInspectorCaso && !valorAsignacionVacio(caso?.ajustador)) {
    for (const p of destinatariosAsignacion(usuarios, 'ajustador', caso.ajustador, actor, [])) {
      push(p);
    }
  }
  return out;
}

function etiquetaRolAsignacion(campo) {
  const c = String(campo || '').toLowerCase();
  if (c === 'inspector') return 'inspector';
  if (c === 'ajustador' || c === 'ajustador_lider') return 'ajustador';
  return '';
}

export function construirContenidoNotificacion({
  tipo,
  modulo,
  casos = [],
  campo = '',
  anticipacionMin = 15,
  actorNombre = '',
  detalle = '',
} = {}) {
  const cfg = configModuloNotificacion(modulo);
  const cantidad = casos.length;
  const primero = casos[0];
  const ruta =
    cantidad === 1 && primero?.id ? cfg.rutaCaso(primero.id) : cfg.rutaLista;
  const rol = etiquetaRolAsignacion(campo);
  const quien = String(actorNombre || '').trim();
  const extra = [quien, detalle].filter(Boolean).join(' · ');
  if (tipo === 'visita') {
    const mins = Math.max(1, Number(anticipacionMin) || 15);
    const franja = [primero?.horaInicio, primero?.horaFin].filter(Boolean).join('–');
    const titulo = `Tienes una visita en ${mins} min · ${cfg.etiqueta}`;
    const mensaje = [primero?.etiqueta, franja, rol ? `como ${rol}` : '']
      .filter(Boolean)
      .join(' · ');
    const fecha = String(primero?.fecha || '').trim();
    return {
      titulo,
      mensaje: mensaje || 'Visita próxima',
      cantidad: 1,
      ruta: fecha ? `/agenda-catastrofico?fecha=${fecha}` : '/agenda-catastrofico',
      campo: rol,
    };
  }
  if (tipo === 'asignacion') {
    const titulo =
      cantidad > 1
        ? rol
          ? `Te asignaron ${cantidad} casos como ${rol} en ${cfg.etiqueta}`
          : `Te asignaron ${cantidad} casos en ${cfg.etiqueta}`
        : rol
          ? `Te asignaron como ${rol} un caso en ${cfg.etiqueta}`
          : `Te asignaron un caso en ${cfg.etiqueta}`;
    const mensaje =
      cantidad > 1
        ? casos
            .slice(0, 4)
            .map((c) => c.etiqueta)
            .join(', ') + (cantidad > 4 ? '…' : '')
        : primero?.etiqueta || 'Caso asignado';
    return { titulo, mensaje, cantidad, ruta, campo: rol };
  }
  if (tipo === 'desasignacion') {
    const titulo =
      cantidad > 1
        ? rol
          ? `Te desasignaron ${cantidad} casos como ${rol} en ${cfg.etiqueta}`
          : `Te desasignaron ${cantidad} casos en ${cfg.etiqueta}`
        : rol
          ? `Te desasignaron como ${rol} un caso en ${cfg.etiqueta}`
          : `Te desasignaron un caso en ${cfg.etiqueta}`;
    const mensaje =
      cantidad > 1
        ? casos
            .slice(0, 4)
            .map((c) => c.etiqueta)
            .join(', ') + (cantidad > 4 ? '…' : '')
        : primero?.etiqueta || 'Caso desasignado';
    return { titulo, mensaje, cantidad, ruta, campo: rol };
  }
  if (tipo === 'estado' || tipo === 'liquidador' || tipo === 'informe' || tipo === 'movimiento') {
    const verbo =
      tipo === 'estado'
        ? 'cambió el estado'
        : tipo === 'liquidador'
          ? 'guardó liquidador'
          : tipo === 'informe'
            ? 'guardó informe'
            : 'actualizó un caso';
    const titulo =
      cantidad > 1
        ? `ERA ${verbo} en ${cantidad} casos · ${cfg.etiqueta}`
        : `ERA ${verbo} · ${cfg.etiqueta}`;
    const baseMsg =
      cantidad > 1
        ? casos
            .slice(0, 4)
            .map((c) => c.etiqueta)
            .join(', ') + (cantidad > 4 ? '…' : '')
        : primero?.etiqueta || 'Caso ERA';
    const mensaje = extra ? `${extra} · ${baseMsg}` : baseMsg;
    return { titulo, mensaje, cantidad, ruta, campo: rol };
  }
  const titulo =
    cantidad > 1
      ? `Se agregaron ${cantidad} casos en ${cfg.etiqueta}`
      : `Nuevo caso en ${cfg.etiqueta}`;
  const mensaje =
    cantidad > 1
      ? casos
          .slice(0, 4)
          .map((c) => c.etiqueta)
          .join(', ') + (cantidad > 4 ? '…' : '')
      : primero?.etiqueta || 'Caso nuevo';
  return { titulo, mensaje, cantidad, ruta };
}
