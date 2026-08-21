/** Estados operativos CAT Terremoto BBVA (metodología vigente). */
export const ESTADOS_BBVA_CAT = [
  'CASO NUEVO',
  'COORDINANDO INSPECCIÓN',
  'ANÁLISIS DEL CASO',
  'PENDIENTE DE DOCUMENTO',
  'OBJECIÓN',
  'AUTORIZACIÓN ANALISTA',
  'CASO PARA PAGO',
];

export const ESTADO_BBVA_CAT_DEFAULT = 'CASO NUEVO';

export const FECHA_ACCION_POR_ESTADO_BBVA_CAT = {
  'CASO NUEVO': 'fechaCasoNuevo',
  'COORDINANDO INSPECCIÓN': 'fechaCoordinandoInspeccion',
  'ANÁLISIS DEL CASO': 'fechaAnalisisCaso',
  'PENDIENTE DE DOCUMENTO': 'fechaSolicitudDocumento',
  OBJECIÓN: 'fechaObjecion',
  'AUTORIZACIÓN ANALISTA': 'fechaAutorizacionAnalista',
  'CASO PARA PAGO': 'fechaCasoParaPago',
};

const LEGACY = {
  PENDIENTE: 'CASO NUEVO',
  'EN INSPECCION': 'COORDINANDO INSPECCIÓN',
  DOCUMENTACION: 'PENDIENTE DE DOCUMENTO',
  LIQUIDADO: 'CASO PARA PAGO',
  'ENVIADO ASEGURADORA': 'CASO PARA PAGO',
  CERRADO: 'CASO PARA PAGO',
};

const sinAcentos = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

export function homologarEstadoBbvaCat(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return ESTADO_BBVA_CAT_DEFAULT;
  if (ESTADOS_BBVA_CAT.includes(raw)) return raw;
  const key = sinAcentos(raw);
  const exacto = ESTADOS_BBVA_CAT.find((est) => sinAcentos(est) === key);
  if (exacto) return exacto;
  return LEGACY[key] || raw;
}

export function aplicarFechaAccionEstadoBbvaCat(payload = {}, base = {}) {
  const estado = homologarEstadoBbvaCat(payload.estado);
  const out = { ...payload, estado };
  const clave = FECHA_ACCION_POR_ESTADO_BBVA_CAT[estado];
  const anterior = homologarEstadoBbvaCat(base.estado);
  if (clave && !out[clave] && anterior !== estado) {
    out[clave] = new Date();
  }
  if (estado === ESTADO_BBVA_CAT_DEFAULT && !out.fechaCasoNuevo) {
    out.fechaCasoNuevo = out.fechaCasoNuevo || base.fechaCasoNuevo || new Date();
  }
  return out;
}
