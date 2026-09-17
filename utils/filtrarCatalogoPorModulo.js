/** Alineado con frontend `catalogosAsignacionCatastrofico.js`. */

export function claveModuloCatalogo(valor) {
  return String(valor || '')
    .toLowerCase()
    .replace(/[-_\s]/g, '');
}

function modsDe(doc = {}) {
  return (Array.isArray(doc.modulos) ? doc.modulos : [])
    .map(claveModuloCatalogo)
    .filter(Boolean);
}

function esTagBbva(m) {
  return m === 'bbvacat' || m === 'bbva';
}

function esTagAlfa(m) {
  return m === 'alfa' || m === 'segurosalfa';
}

export function esModuloBbvaCat(modulo = '') {
  const c = claveModuloCatalogo(modulo);
  return c === 'bbvacat' || c === 'bbva' || c === 'bbvacatlistado';
}

export function esModuloAlfa(modulo = '') {
  const c = claveModuloCatalogo(modulo);
  return c === 'alfa' || c === 'segurosalfa';
}

export function esModuloZurich(modulo = '') {
  const c = claveModuloCatalogo(modulo);
  return c === 'zurich' || c === 'zurichlistado';
}

/** Arnaldo Tapia no opera el equipo Zurich. */
export function esExcluidoCatalogoZurich(nombre) {
  const n = String(nombre || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();
  return n.includes('ARNALDO') && n.includes('TAPIA');
}

/**
 * Equipos cerrados: BBVA y Alfa solo listan a quienes tienen ese módulo.
 * BBVA es extra: tener bbvaCat no saca a la persona de Zurich/Sura/Previsora/Allianz/Equidad.
 * Alfa sí es exclusivo si no tiene tags generales.
 * Vacío o solo bbvaCat = catálogo general.
 */
export function catalogoPerteneceAModulo(doc, modulo = '') {
  const mods = modsDe(doc);
  if (esModuloBbvaCat(modulo)) {
    return mods.some(esTagBbva);
  }
  if (esModuloAlfa(modulo)) {
    return mods.some(esTagAlfa);
  }
  if (esModuloZurich(modulo) && esExcluidoCatalogoZurich(doc.nombre || doc.label || doc.nmbrRespnsble)) {
    return false;
  }
  const modsGenerales = mods.filter((m) => !esTagBbva(m) && !esTagAlfa(m));
  const tieneAlfa = mods.some(esTagAlfa);
  if (!mods.length || (!modsGenerales.length && !tieneAlfa)) return true;
  const clave = claveModuloCatalogo(modulo);
  if (!clave) return modsGenerales.length > 0 || !tieneAlfa;
  return modsGenerales.includes(clave);
}

/** Ajustadora líder de Zurich (quien asigna). Independiente del rol de ajustadora de campo. */
export const LIDER_ZURICH = 'Ladys Andrea Escalante';

export function aplicarLiderZurich(valor) {
  const t = String(valor || '').trim();
  return t || LIDER_ZURICH;
}
