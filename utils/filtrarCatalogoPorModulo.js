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

/**
 * Equipos cerrados: BBVA y Alfa solo listan a quienes tienen ese módulo.
 * El resto (Zurich, Sura, Previsora, Allianz) usa el catálogo general
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
  if (!mods.length) return true;
  const clave = claveModuloCatalogo(modulo);
  if (!clave) {
    return mods.some(
      (m) => m !== 'bbvacat' && m !== 'bbva' && m !== 'alfa' && m !== 'segurosalfa'
    );
  }
  return mods.includes(clave);
}
