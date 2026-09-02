/**
 * Líderes de cada área CAT: ven toda la agenda y los casos de su módulo.
 * Ajustador/inspector de campo solo ve lo asignado (ajustador o inspector).
 */
export const LIDERES_AREA_CATASTROFICO = Object.freeze([
  {
    clave: 'zurich',
    etiqueta: 'Ladys Escalante',
    needles: ['LADYS'],
    fuentes: ['zurich', 'zurichListado'],
  },
  {
    clave: 'sura',
    etiqueta: 'Bernardo Sojo',
    needles: ['BERNARDO'],
    fuentes: ['sura'],
  },
  {
    clave: 'previsora',
    etiqueta: 'Iskharly Tapia',
    needles: ['ISKHARLY'],
    fuentes: ['previsora', 'previsoraListado'],
  },
  {
    clave: 'allianz',
    etiqueta: 'Mario Pinilla',
    needles: ['PINILLA'],
    fuentes: ['allianz', 'allianzListado'],
  },
  {
    clave: 'bbva',
    etiqueta: 'Miguel Baez',
    needles: ['BAEZ'],
    fuentes: ['bbvaCat', 'bbvaCatListado'],
  },
  {
    clave: 'equidad',
    etiqueta: 'Arnaldo Tapia',
    needles: ['ARNALDO'],
    fuentes: ['equidadCat'],
  },
  {
    clave: 'alfa',
    etiqueta: 'Silvia Rodriguez',
    needles: ['SILVIA'],
    fuentes: ['alfa'],
  },
]);

export function claveFuenteAgenda(modulo = '') {
  return String(modulo || '')
    .toLowerCase()
    .replace(/[-_\s]/g, '');
}

function haystackNombre(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s*\([^)]*\)/g, ' ')
    .trim()
    .toUpperCase();
}

export function needlesLiderModulo(modulo = '') {
  const c = claveFuenteAgenda(modulo);
  if (c === 'alfa' || c === 'segurosalfa') return ['SILVIA'];
  if (c === 'sura' || c === 'segurossura') return ['BERNARDO'];
  if (c.includes('zurich')) return ['LADYS'];
  if (c.includes('bbva')) return ['BAEZ'];
  if (c.includes('previsora')) return ['ISKHARLY'];
  if (c.includes('allianz')) return ['PINILLA'];
  if (c.includes('equidad')) return ['ARNALDO'];
  return [];
}

export function nombreCoincideNeedleLider(nombre, needle) {
  const n = haystackNombre(needle);
  const hay = haystackNombre(nombre);
  return Boolean(n && hay && hay.includes(n));
}

export function identidadCoincideNeedlesLider(identidad = {}, needles = []) {
  const hay = haystackNombre(identidad.name || identidad.nombre || '');
  if (!hay) return false;
  return (needles || []).some((n) => hay.includes(haystackNombre(n)));
}

export function fuentesLideradasPorIdentidad(identidad = {}) {
  const hay = haystackNombre(identidad.name || identidad.nombre || '');
  if (!hay) return [];
  const fuentes = [];
  for (const area of LIDERES_AREA_CATASTROFICO) {
    if (area.needles.some((n) => hay.includes(haystackNombre(n)))) {
      fuentes.push(...area.fuentes);
    }
  }
  return [...new Set(fuentes)];
}

export function identidadEsLiderDeFuente(identidad = {}, modulo = '') {
  const needles = needlesLiderModulo(modulo);
  return identidadCoincideNeedlesLider(identidad, needles);
}
