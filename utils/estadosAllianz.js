/** Estados operativos Allianz (listado y CAT). */
export const ESTADOS_ALLIANZ = [
  'CASO NUEVO',
  'PRIMER CONTACTO',
  'INSPECCIÓN COORDINADA',
  'INSPECCIÓN REALIZADA',
  'ANÁLISIS DE CASO',
  'PENDIENTE DOCUMENTOS',
  'OBJECIÓN',
  'PENDIENTE APROBACIÓN ANALISTA',
  'PRESENTACIÓN DE CIFRAS',
  'CASO PARA PAGO',
  'DESISTIDO',
  'ANULADO/CANCELADO',
];

export const ESTADO_ALLIANZ_DEFAULT = 'CASO NUEVO';

export const ESTADOS_CIERRE_ALLIANZ = ['DESISTIDO', 'ANULADO/CANCELADO'];

export const FECHA_ACCION_POR_ESTADO_ALLIANZ = {
  'CASO NUEVO': 'fechaCasoNuevo',
  'PRIMER CONTACTO': 'fechaPrimerContacto',
  'INSPECCIÓN COORDINADA': 'fechaCoordinandoInspeccion',
  'INSPECCIÓN REALIZADA': 'fechaInspeccionRealizada',
  'ANÁLISIS DE CASO': 'fechaAnalisisCaso',
  'PENDIENTE DOCUMENTOS': 'fechaSolicitudDocumento',
  OBJECIÓN: 'fechaObjecion',
  'PENDIENTE APROBACIÓN ANALISTA': 'fechaAutorizacionAnalista',
  'PRESENTACIÓN DE CIFRAS': 'fechaPresentacionCifras',
  'CASO PARA PAGO': 'fechaCasoParaPago',
  DESISTIDO: 'fechaDesistido',
  'ANULADO/CANCELADO': 'fechaAnulado',
};

const LEGACY = {
  PENDIENTE: 'CASO NUEVO',
  'EN INSPECCION': 'INSPECCIÓN COORDINADA',
  'COORDINANDO INSPECCION': 'INSPECCIÓN COORDINADA',
  'INSPECCION COORDINADA': 'INSPECCIÓN COORDINADA',
  'CASO INSPECCIONADO': 'INSPECCIÓN REALIZADA',
  INSPECCIONADO: 'INSPECCIÓN REALIZADA',
  'INSPECCION REALIZADA': 'INSPECCIÓN REALIZADA',
  'ANALISIS DEL CASO': 'ANÁLISIS DE CASO',
  'ANALISIS DE CASO': 'ANÁLISIS DE CASO',
  DOCUMENTACION: 'PENDIENTE DOCUMENTOS',
  'PENDIENTE DE DOCUMENTO': 'PENDIENTE DOCUMENTOS',
  'PENDIENTE DE DOCUMENTOS': 'PENDIENTE DOCUMENTOS',
  'PENDIENTE DOCUMENTO': 'PENDIENTE DOCUMENTOS',
  'AUTORIZACION ANALISTA': 'PENDIENTE APROBACIÓN ANALISTA',
  'PENDIENTE APROBACION ANALISTA': 'PENDIENTE APROBACIÓN ANALISTA',
  'PRESENTACION DE CIFRAS': 'PRESENTACIÓN DE CIFRAS',
  LIQUIDADO: 'CASO PARA PAGO',
  'ENVIADO ASEGURADORA': 'CASO PARA PAGO',
  OBJECTED: 'OBJECIÓN',
  OBJETADO: 'OBJECIÓN',
  'CASO OBJETADO': 'OBJECIÓN',
  'OBJECION CERRADA': 'OBJECIÓN',
  'OBJECION FINAL': 'OBJECIÓN',
  PAGO: 'CASO PARA PAGO',
  PAGADO: 'CASO PARA PAGO',
  'CASO PAGADO': 'CASO PARA PAGO',
  INDEMNIZADO: 'CASO PARA PAGO',
  GIRADO: 'CASO PARA PAGO',
  'CASE PAID': 'CASO PARA PAGO',
  CERRADO: 'CASO PARA PAGO',
  'CERRADO MANUAL': 'CASO PARA PAGO',
  DESISTIMIENTO: 'DESISTIDO',
  ANULADO: 'ANULADO/CANCELADO',
  CANCELADO: 'ANULADO/CANCELADO',
  'ANULADO CANCELADO': 'ANULADO/CANCELADO',
  'SIN COBERTURA': 'ANULADO/CANCELADO',
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
  if (estado === 'INSPECCIÓN REALIZADA' && !out.fechaInspeccionRealizada) {
    out.fechaInspeccionRealizada = out.fechaVisita || out.fechaInspeccion || out.fechaInspeccionRealizada;
  }
  if (estado === 'PRIMER CONTACTO' && !out.fechaPrimerContacto) {
    out.fechaPrimerContacto = out.fechaLlamada || out.fechaPrimerContacto;
  }
  if (estado === ESTADO_ALLIANZ_DEFAULT && !out.fechaCasoNuevo) {
    out.fechaCasoNuevo = out.fechaCasoNuevo || base.fechaCasoNuevo || new Date();
  }
  return out;
}
