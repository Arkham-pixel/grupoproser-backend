/** Estados operativos CAT Allianz (misma metodología que BBVA, con cierre). */
export const ESTADOS_ALLIANZ = [
  'CASO NUEVO',
  'COORDINANDO INSPECCIÓN',
  'ANÁLISIS DEL CASO',
  'PENDIENTE DE DOCUMENTO',
  'OBJECIÓN',
  'OBJETADO',
  'AUTORIZACIÓN ANALISTA',
  'CASO PARA PAGO',
  'PAGADO',
  'ANULADO',
];

export const ESTADO_ALLIANZ_DEFAULT = 'CASO NUEVO';

export const ESTADOS_CIERRE_ALLIANZ = ['OBJETADO', 'PAGADO', 'ANULADO'];

export const FECHA_ACCION_POR_ESTADO_ALLIANZ = {
  'CASO NUEVO': 'fechaCasoNuevo',
  'COORDINANDO INSPECCIÓN': 'fechaCoordinandoInspeccion',
  'ANÁLISIS DEL CASO': 'fechaAnalisisCaso',
  'PENDIENTE DE DOCUMENTO': 'fechaSolicitudDocumento',
  OBJECIÓN: 'fechaObjecion',
  OBJETADO: 'fechaObjetado',
  'AUTORIZACIÓN ANALISTA': 'fechaAutorizacionAnalista',
  'CASO PARA PAGO': 'fechaCasoParaPago',
  PAGADO: 'fechaCasoPagado',
  ANULADO: 'fechaAnulado',
};

const LEGACY = {
  PENDIENTE: 'CASO NUEVO',
  'EN INSPECCION': 'COORDINANDO INSPECCIÓN',
  DOCUMENTACION: 'PENDIENTE DE DOCUMENTO',
  LIQUIDADO: 'CASO PARA PAGO',
  'ENVIADO ASEGURADORA': 'CASO PARA PAGO',
  OBJECTED: 'OBJETADO',
  'CASO OBJETADO': 'OBJETADO',
  'OBJECION CERRADA': 'OBJETADO',
  'OBJECION FINAL': 'OBJETADO',
  PAGO: 'PAGADO',
  'CASO PAGADO': 'PAGADO',
  INDEMNIZADO: 'PAGADO',
  GIRADO: 'PAGADO',
  'CASE PAID': 'PAGADO',
  CERRADO: 'PAGADO',
  'CERRADO MANUAL': 'PAGADO',
  CANCELADO: 'ANULADO',
  'SIN COBERTURA': 'ANULADO',
};

const sinAcentos = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

export function homologarEstadoAllianz(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return ESTADO_ALLIANZ_DEFAULT;
  if (ESTADOS_ALLIANZ.includes(raw)) return raw;
  const key = sinAcentos(raw);
  const exacto = ESTADOS_ALLIANZ.find((est) => sinAcentos(est) === key);
  if (exacto) return exacto;
  return LEGACY[key] || raw;
}

export function esEstadoCerradoAllianz(valor) {
  const key = sinAcentos(homologarEstadoAllianz(valor));
  return ESTADOS_CIERRE_ALLIANZ.some((est) => sinAcentos(est) === key);
}

export function aplicarFechaAccionEstadoAllianz(payload = {}, base = {}) {
  const estado = homologarEstadoAllianz(payload.estado);
  const out = { ...payload, estado };
  const clave = FECHA_ACCION_POR_ESTADO_ALLIANZ[estado];
  const anterior = homologarEstadoAllianz(base.estado);
  if (clave && !out[clave] && anterior !== estado) {
    out[clave] = new Date();
  }
  if (estado === ESTADO_ALLIANZ_DEFAULT && !out.fechaCasoNuevo) {
    out.fechaCasoNuevo = out.fechaCasoNuevo || base.fechaCasoNuevo || new Date();
  }
  return out;
}
