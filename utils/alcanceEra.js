/**
 * Alcance de casos para la firma ERA: solo el pool Alfa que se les asigne.
 * Hasta que Proser asigne (ajustador/inspector ERA o firmaAjuste=ERA), el listado queda vacío.
 */
import SecurUser from '../models/SecurUser.js';
import { ROL_ERA } from '../config/roles.js';
import {
  coincidenPersonas,
  construirFiltroVistaAsignacion,
  casoVisibleParaIdentidad,
  ramasFiltroCampoPersona,
} from './permisosCasoPorRol.js';
import {
  FIRMA_ERA,
  casoMarcadoFirmaEra,
  esIdentidadEra,
} from './jerarquiaEra.js';

const CACHE_MS = 30_000;
let cachePersonas = { at: 0, personas: [] };

export async function cargarPersonasEra() {
  const ahora = Date.now();
  if (ahora - cachePersonas.at < CACHE_MS && cachePersonas.personas.length) {
    return cachePersonas.personas;
  }
  const personas = await SecurUser.find({
    active: { $ne: 'N' },
    $or: [{ role: ROL_ERA }, { empresa: { $regex: /^era$/i } }],
  })
    .select('_id login name cedula email role empresa')
    .lean();
  cachePersonas = { at: ahora, personas };
  return personas;
}

export function invalidarCachePersonasEra() {
  cachePersonas = { at: 0, personas: [] };
}

function clavesPersonaEra(persona = {}) {
  return [...new Set(
    [persona.name, persona.nombre, persona.login, persona.cedula]
      .map((s) => String(s || '').trim())
      .filter(Boolean)
  )];
}

export function personaEraCoincideValor(persona, valor) {
  return clavesPersonaEra(persona).some((k) => coincidenPersonas(valor, k));
}

export function casoTienePersonaEra(caso = {}, personas = []) {
  const campos = [caso.ajustador, caso.inspector, caso.ajustadorLider];
  return personas.some((p) => campos.some((c) => personaEraCoincideValor(p, c)));
}

export function casoPerteneceAPoolEra(caso = {}, personas = []) {
  if (casoMarcadoFirmaEra(caso)) return true;
  return casoTienePersonaEra(caso, personas);
}

export function construirFiltroMongoPoolEra(personas = []) {
  const or = [{ firmaAjuste: FIRMA_ERA }, { firmaAjuste: { $regex: /^era$/i } }];
  for (const p of personas) {
    for (const clave of clavesPersonaEra(p)) {
      or.push(...ramasFiltroCampoPersona('ajustador', clave));
      or.push(...ramasFiltroCampoPersona('inspector', clave));
      or.push(...ramasFiltroCampoPersona('ajustadorLider', clave));
    }
  }
  return { $or: or };
}

export async function construirFiltroVistaEra() {
  const personas = await cargarPersonasEra();
  return construirFiltroMongoPoolEra(personas);
}

/**
 * Filtro de listados: ERA ve solo el pool de la firma; el resto usa asignación normal.
 */
export async function construirFiltroVistaCasos(identidad, opts = {}) {
  if (esIdentidadEra(identidad)) {
    return construirFiltroVistaEra();
  }
  return construirFiltroVistaAsignacion(identidad, opts);
}

export async function casoVisibleParaIdentidadCasos(caso, identidad, opts = {}) {
  if (!esIdentidadEra(identidad)) {
    return casoVisibleParaIdentidad(caso, identidad, opts);
  }
  const personas = await cargarPersonasEra();
  return casoPerteneceAPoolEra(caso, personas);
}

export async function aplicarFirmaAjusteSiCorresponde(payload = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  if (casoMarcadoFirmaEra(payload)) {
    payload.firmaAjuste = FIRMA_ERA;
    return payload;
  }
  const personas = await cargarPersonasEra();
  if (casoTienePersonaEra(payload, personas)) {
    payload.firmaAjuste = FIRMA_ERA;
  }
  return payload;
}

export { modoEdicionEraDelCaso } from './permisosCasoPorRol.js';

