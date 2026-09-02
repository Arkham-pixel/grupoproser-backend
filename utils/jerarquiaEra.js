/**
 * Cadena operativa ERA (firma ajustadora externa) en catastrófico / Alfa:
 * Líder Proser Ajustes → Líder ERA → Ajustador ERA → Inspector ERA.
 *
 * No asigna casos: solo identifica actores y el sello de firma.
 */
import { normalizarRol, ROL_ERA } from '../config/roles.js';

export { ROL_ERA };

export const FIRMA_ERA = 'ERA';

/** Erick Aramis Quevedo Gonzalez — líder de la firma ERA. */
export const LIDER_ERA = Object.freeze({
  login: '4201038754011',
  needles: ['ERICK'],
  etiqueta: 'Líder ERA',
});

/** Silvia Rodriguez — líder Proser Ajustes en Alfa (quien recibe todos los avisos). */
export const LIDER_PROSER_AJUSTES = Object.freeze({
  needles: ['SILVIA'],
  etiqueta: 'Líder Proser Ajustes',
  modulo: 'alfa',
});

export function haystackPersona(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s*\([^)]*\)/g, ' ')
    .trim()
    .toUpperCase();
}

export function claveDocumentoEra(valor) {
  const s = String(valor || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  return digits.length >= 5 ? digits : s.toLowerCase();
}

export function esRolEra(rol) {
  return normalizarRol(rol) === ROL_ERA;
}

export function esEmpresaEra(empresa) {
  return haystackPersona(empresa) === FIRMA_ERA;
}

export function esIdentidadEra(identidad = {}) {
  if (esRolEra(identidad.rol || identidad.role)) return true;
  return esEmpresaEra(identidad.empresa);
}

export function esIdentidadLiderEra(identidad = {}) {
  const login = claveDocumentoEra(identidad.login || identidad.cedula);
  if (login && login === LIDER_ERA.login) return true;
  if (!esIdentidadEra(identidad)) return false;
  const hay = haystackPersona(identidad.name || identidad.nombre || '');
  return Boolean(hay) && LIDER_ERA.needles.some((n) => hay.includes(haystackPersona(n)));
}

export function esIdentidadLiderProserAjustes(identidad = {}) {
  const hay = haystackPersona(identidad.name || identidad.nombre || '');
  if (!hay) return false;
  return LIDER_PROSER_AJUSTES.needles.some((n) => hay.includes(haystackPersona(n)));
}

export function usuarioEsLiderEra(usuario = {}) {
  return esIdentidadLiderEra({
    login: usuario.login,
    cedula: usuario.cedula,
    name: usuario.name || usuario.nombre,
    nombre: usuario.nombre || usuario.name,
    rol: usuario.role || usuario.rol,
    empresa: usuario.empresa,
  });
}

export function usuarioEsLiderProserAjustes(usuario = {}) {
  return esIdentidadLiderProserAjustes({
    name: usuario.name || usuario.nombre,
    nombre: usuario.nombre || usuario.name,
    login: usuario.login,
    cedula: usuario.cedula,
  });
}

export function casoMarcadoFirmaEra(caso = {}) {
  return haystackPersona(caso.firmaAjuste) === FIRMA_ERA;
}
