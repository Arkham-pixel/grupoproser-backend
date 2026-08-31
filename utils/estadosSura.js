export const ESTADOS_SURA = [
  'CASO NUEVO',
  'ASIGNADO (PARA ASIGNAR INSPECTOR)',
  'INSPECCIONADO',
  'INFORME DEL INSPECTOR',
  'INFORME PRELIMINAR Y/O ACTUALIZACIÓN',
  'INFORME ÚNICO O FINAL',
  'ANULADO',
];

export const ESTADOS_SURA_CERRADOS = ['ANULADO', 'CERRADO'];

const MAPA_LEGADO = {
  PENDIENTE: 'CASO NUEVO',
  'EN INSPECCION': 'ASIGNADO (PARA ASIGNAR INSPECTOR)',
  'EN INSPECCIÓN': 'ASIGNADO (PARA ASIGNAR INSPECTOR)',
  DOCUMENTACION: 'INFORME DEL INSPECTOR',
  DOCUMENTACIÓN: 'INFORME DEL INSPECTOR',
  LIQUIDADO: 'INFORME ÚNICO O FINAL',
  'ENVIADO ASEGURADORA': 'INFORME ÚNICO O FINAL',
  CERRADO: 'INFORME ÚNICO O FINAL',
};

function norm(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function normalizarEstadoSura(valor) {
  const raw = String(valor ?? '').trim();
  if (!raw) return 'CASO NUEVO';
  if (ESTADOS_SURA.includes(raw)) return raw;
  const mapeado = MAPA_LEGADO[raw] || MAPA_LEGADO[norm(raw)];
  if (mapeado) return mapeado;
  const hit = ESTADOS_SURA.find((e) => norm(e) === norm(raw));
  return hit || raw;
}

export function esEstadoSuraCerrado(valor) {
  const n = normalizarEstadoSura(valor);
  return ESTADOS_SURA_CERRADOS.includes(n) || norm(valor) === 'CERRADO';
}

export const ESTADO_SURA_INFORME_UNICO = 'INFORME ÚNICO O FINAL';

function tipoInformeSura(valor) {
  const t = String(valor ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
  if (t === 'preliminar' || t === 'final' || t === 'unico') return t;
  return '';
}

/** Único/final pasan el caso a INFORME ÚNICO O FINAL (equivalente a liquidado). */
export function estadoSuraPorTipoInforme(tipoInforme, estadoActual) {
  const tipo = tipoInformeSura(tipoInforme);
  const actual = normalizarEstadoSura(estadoActual);
  if (actual === 'ANULADO') return actual;
  if (tipo !== 'unico' && tipo !== 'final') return actual;
  return ESTADO_SURA_INFORME_UNICO;
}

export function aplicarEstadoDesdeTipoInformeSura(payload = {}, base = {}) {
  const estadoEnviado = payload.estado;
  const estadoBase = base.estado;
  if (
    estadoEnviado != null &&
    String(estadoEnviado).trim() !== '' &&
    normalizarEstadoSura(estadoEnviado) !== normalizarEstadoSura(estadoBase)
  ) {
    return payload;
  }
  const tipo = payload?.informeUnico?.tipoInforme ?? base?.informeUnico?.tipoInforme;
  const siguiente = estadoSuraPorTipoInforme(tipo, payload.estado || base.estado);
  if (!siguiente || siguiente === normalizarEstadoSura(payload.estado || base.estado)) {
    return payload;
  }
  return {
    ...payload,
    estado: siguiente,
    descripcionEstado: siguiente,
  };
}
