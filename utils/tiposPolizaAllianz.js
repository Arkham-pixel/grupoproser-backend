/** Tipos de póliza Allianz (listado y CAT). */
export const TIPOS_POLIZA_ALLIANZ = [
  'HOGAR',
  'HOGAR DEUDOR',
  'PYME',
  'MULTIRRIESGOS HOGAR',
  'MULTIRRIESGOS EMPRESARIAL',
  'NEGOCIO EMPRESARIAL',
];

const claveTipoPolizaAllianz = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const LEGACY = {
  HOMEOWNERS: 'HOGAR',
  'HOME OWNERS': 'HOGAR',
  HOME: 'HOGAR',
  'HOGAR DEUDORES': 'HOGAR DEUDOR',
  DEUDOR: 'HOGAR DEUDOR',
  DEUDORES: 'HOGAR DEUDOR',
  HIPOTECARIO: 'HOGAR DEUDOR',
  PYMES: 'PYME',
  'MULTIRRIESGO HOGAR': 'MULTIRRIESGOS HOGAR',
  'MULTI RIESGOS HOGAR': 'MULTIRRIESGOS HOGAR',
  'MULTI RIESGO HOGAR': 'MULTIRRIESGOS HOGAR',
  'MR HOGAR': 'MULTIRRIESGOS HOGAR',
  'MULTIRRIESGO EMPRESARIAL': 'MULTIRRIESGOS EMPRESARIAL',
  'MULTI RIESGOS EMPRESARIAL': 'MULTIRRIESGOS EMPRESARIAL',
  'MULTI RIESGO EMPRESARIAL': 'MULTIRRIESGOS EMPRESARIAL',
  'MR EMPRESARIAL': 'MULTIRRIESGOS EMPRESARIAL',
  NEGOCIO: 'NEGOCIO EMPRESARIAL',
  'NEGOCIOS EMPRESARIALES': 'NEGOCIO EMPRESARIAL',
};

function resolverTipoPolizaAllianz(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return '';
  if (TIPOS_POLIZA_ALLIANZ.includes(raw)) return raw;
  const key = claveTipoPolizaAllianz(raw);
  if (!key) return '';
  const exacto = TIPOS_POLIZA_ALLIANZ.find((tipo) => claveTipoPolizaAllianz(tipo) === key);
  if (exacto) return exacto;
  if (LEGACY[key]) return LEGACY[key];
  if (key.includes('HOGAR') && key.includes('DEUDOR')) return 'HOGAR DEUDOR';
  if (key.includes('MULTIRRIESGO') && key.includes('HOGAR')) return 'MULTIRRIESGOS HOGAR';
  if (key.includes('MULTI RIESGO') && key.includes('HOGAR')) return 'MULTIRRIESGOS HOGAR';
  if (key.includes('MULTIRRIESGO') && (key.includes('EMPRESARIAL') || key.includes('EMPRESA'))) {
    return 'MULTIRRIESGOS EMPRESARIAL';
  }
  if (key.includes('MULTI RIESGO') && (key.includes('EMPRESARIAL') || key.includes('EMPRESA'))) {
    return 'MULTIRRIESGOS EMPRESARIAL';
  }
  if (key.includes('NEGOCIO')) return 'NEGOCIO EMPRESARIAL';
  if (key === 'HOGAR' || key === 'HOMEOWNERS' || key === 'HOME') return 'HOGAR';
  if (key === 'PYME' || key === 'PYMES' || /\bPYME/.test(key)) return 'PYME';
  return '';
}

export function homologarTipoPolizaAllianz(valor, detalle = '') {
  return resolverTipoPolizaAllianz(valor) || resolverTipoPolizaAllianz(detalle) || String(valor || '').trim();
}
