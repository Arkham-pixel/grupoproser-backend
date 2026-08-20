/**
 * Resuelve apodos del Excel Zurich contra catálogos
 * /api/inspectores-catastrofico y /api/ajustadores-catastrofico.
 */

export const normPersonaCatastrofico = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Apodos del listado cliente → nombre canónico del catálogo. */
const ALIAS_PERSONA = {
  MARIO: 'MARIO ALBERTO PINILLA',
  'MARIO PINILLA': 'MARIO ALBERTO PINILLA',
  'MARIO ALBERTO PINILLA': 'MARIO ALBERTO PINILLA',
  LADYS: 'LADYS ANDREA ESCALANTE',
  'LADYS ESCALANTE': 'LADYS ANDREA ESCALANTE',
  'LADYS ESCALALNTE': 'LADYS ANDREA ESCALANTE',
  'LADYS ANDREA ESCALANTE': 'LADYS ANDREA ESCALANTE',
  'MARIA P': 'MARIA GARCIA MANJARRES',
  'MARIA T': 'MARIA GARCIA MANJARRES',
  'MARIA TRINIDAD': 'MARIA GARCIA MANJARRES',
  MARIA: 'MARIA GARCIA MANJARRES',
  SANTIAGO: 'SANTIAGO BELTRAN',
  'SANTIAGO BELTRAN': 'SANTIAGO BELTRAN',
};

const esPlaceholderPersona = (valor) => {
  const n = normPersonaCatastrofico(valor);
  return !n || /^(PENDIENTE|N A|NA|SIN ASIGNAR|POR CONFIRMAR|-)$/.test(n);
};

const tokens = (norm) => norm.split(' ').filter(Boolean);

const coincideCatalogo = (queryNorm, nombreNorm) => {
  if (!queryNorm || !nombreNorm) return 0;
  if (queryNorm === nombreNorm) return 100;
  if (nombreNorm.startsWith(`${queryNorm} `)) return 90;
  if (nombreNorm.includes(` ${queryNorm} `) || nombreNorm.endsWith(` ${queryNorm}`)) return 80;
  const qTok = tokens(queryNorm);
  const nTok = tokens(nombreNorm);
  if (qTok.length >= 2 && qTok.every((t) => nTok.includes(t))) return 85;
  if (qTok.length === 1 && nTok[0] === qTok[0] && nTok.length >= 2) return 60;
  return 0;
};

export const buscarEnCatalogo = (query, catalogo = []) => {
  if (esPlaceholderPersona(query)) return null;
  const crudo = normPersonaCatastrofico(query);
  const alias = ALIAS_PERSONA[crudo] || crudo;
  let mejor = null;
  let empate = false;
  for (const item of catalogo) {
    const nombre = String(item?.nombre || item?.label || '').trim();
    const nombreNorm = normPersonaCatastrofico(nombre);
    const score = Math.max(
      coincideCatalogo(alias, nombreNorm),
      coincideCatalogo(crudo, nombreNorm)
    );
    if (score <= 0) continue;
    if (!mejor || score > mejor.score) {
      mejor = { nombre, score, item };
      empate = false;
    } else if (score === mejor.score && nombre !== mejor.nombre) {
      empate = true;
    }
  }
  if (!mejor || empate) return null;
  if (mejor.score < 60) return null;
  return mejor.nombre;
};

/**
 * Coloca a cada persona en inspector o ajustador según el catálogo.
 * Si el Excel lo pone en la columna incorrecta, se corrige.
 */
export const resolverAsignacionCatastrofico = ({
  inspectorExcel = '',
  ajustadorExcel = '',
  inspectores = [],
  ajustadores = [],
} = {}) => {
  const inspectorEnInspectores = buscarEnCatalogo(inspectorExcel, inspectores);
  const inspectorEnAjustadores = buscarEnCatalogo(inspectorExcel, ajustadores);
  const ajustadorEnAjustadores = buscarEnCatalogo(ajustadorExcel, ajustadores);
  const ajustadorEnInspectores = buscarEnCatalogo(ajustadorExcel, inspectores);

  let inspector = inspectorEnInspectores || null;
  let ajustador = ajustadorEnAjustadores || null;

  if (!inspector && inspectorEnAjustadores && !ajustador) {
    ajustador = inspectorEnAjustadores;
  }
  if (!ajustador && ajustadorEnInspectores && !inspector) {
    inspector = ajustadorEnInspectores;
  }
  if (!inspector && inspectorExcel && !esPlaceholderPersona(inspectorExcel) && !inspectorEnAjustadores) {
    inspector = String(inspectorExcel).trim();
  }
  if (!ajustador && ajustadorExcel && !esPlaceholderPersona(ajustadorExcel) && !ajustadorEnInspectores) {
    ajustador = String(ajustadorExcel).trim();
  }

  return {
    inspector,
    ajustador,
    inspectorResuelto: Boolean(inspectorEnInspectores),
    ajustadorResuelto: Boolean(ajustadorEnAjustadores || inspectorEnAjustadores),
    inspectorSinCatalogo: Boolean(
      inspector && !inspectorEnInspectores && !inspectorEnAjustadores
    ),
    ajustadorSinCatalogo: Boolean(
      ajustador && !ajustadorEnAjustadores && !ajustadorEnInspectores
    ),
  };
};
