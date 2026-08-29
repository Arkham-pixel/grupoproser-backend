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
 * El resto (Zurich, Sura, Previsora, Allianz, Equidad CAT) usa el catálogo general
 * (sin `modulos`) o el tag explícito del módulo.
 */
export function catalogoPerteneceAModulo(doc, modulo = '') {
  const mods = modsDe(doc);
  if (esModuloBbvaCat(modulo)) {
    return mods.some((m) => m === 'bbvacat' || m === 'bbva');
  }
  if (esModuloAlfa(modulo)) {
    return mods.some((m) => m === 'alfa' || m === 'segurosalfa');
  }
  if (esModuloZurich(modulo) && esExcluidoCatalogoZurich(doc.nombre || doc.label || doc.nmbrRespnsble)) {
    return false;
  }
  if (!mods.length) return true;
  const clave = claveModuloCatalogo(modulo);
  if (!clave) {
    return mods.some(
      (m) => m !== 'bbvacat' && m !== 'bbva' && m !== 'alfa' && m !== 'segurosalfa'
    );
  }
  return mods.includes(clave);
}

/** Ajustadora líder de Zurich (quien asigna). Independiente del rol de ajustadora de campo. */
export const LIDER_ZURICH = 'Ladys Andrea Escalante';

export function aplicarLiderZurich(valor) {
  const t = String(valor || '').trim();
  return t || LIDER_ZURICH;
}
