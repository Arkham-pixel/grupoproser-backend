/** Estados operativos Zurich (flujo propio, distinto de Alfa/BBVA). */
export const ESTADOS_ZURICH = [
  'CASO NUEVO',
  'INSPECCIÓN COORDINADA',
  'INSPECCIONADO',
  'VERIFICADO',
  'PENDIENTE DOCUMENTOS',
  'LIQUIDADO',
  'OBJETADO',
];

export const ESTADO_ZURICH_DEFAULT = 'CASO NUEVO';

export const FECHA_ACCION_POR_ESTADO_ZURICH = {
  'CASO NUEVO': 'fechaCasoNuevo',
  'INSPECCIÓN COORDINADA': 'fechaCoordinandoInspeccion',
  INSPECCIONADO: 'fechaInspeccionado',
  VERIFICADO: 'fechaVerificado',
  'PENDIENTE DOCUMENTOS': 'fechaSolicitudDocumento',
  LIQUIDADO: 'fechaLiquidado',
  OBJETADO: 'fechaObjecion',
};

const LEGACY = {
  PENDIENTE: 'CASO NUEVO',
  'EN INSPECCION': 'INSPECCIÓN COORDINADA',
  'COORDINANDO INSPECCION': 'INSPECCIÓN COORDINADA',
  'INSPCCION COODINADA': 'INSPECCIÓN COORDINADA',
  'INSPCION COORDINADA': 'INSPECCIÓN COORDINADA',
  'ANALISIS DEL CASO': 'INSPECCIONADO',
  DOCUMENTACION: 'PENDIENTE DOCUMENTOS',
  'PENDIENTE DE DOCUMENTO': 'PENDIENTE DOCUMENTOS',
  'PENDIENTE DE DOCUMENTOS': 'PENDIENTE DOCUMENTOS',
  OBJECION: 'OBJETADO',
  'CASO OBJETADO': 'OBJETADO',
  'AUTORIZACION ANALISTA': 'LIQUIDADO',
  'CASO PARA PAGO': 'LIQUIDADO',
  'ENVIADO ASEGURADORA': 'LIQUIDADO',
  CERRADO: 'LIQUIDADO',
};

const sinAcentos = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

export function homologarEstadoZurich(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return ESTADO_ZURICH_DEFAULT;
  if (ESTADOS_ZURICH.includes(raw)) return raw;
  const key = sinAcentos(raw);
  const exacto = ESTADOS_ZURICH.find((est) => sinAcentos(est) === key);
  if (exacto) return exacto;
  return LEGACY[key] || raw;
}

function campoFechaPorEstadoZurich(estado) {
  const homologado = homologarEstadoZurich(estado);
  if (FECHA_ACCION_POR_ESTADO_ZURICH[homologado]) return FECHA_ACCION_POR_ESTADO_ZURICH[homologado];
  const key = sinAcentos(homologado);
  const match = Object.keys(FECHA_ACCION_POR_ESTADO_ZURICH).find((k) => sinAcentos(k) === key);
  return match ? FECHA_ACCION_POR_ESTADO_ZURICH[match] : '';
}

const fechaVacia = (valor) =>
  valor == null || valor === '' || (typeof valor === 'string' && !String(valor).trim());

export function aplicarFechaAccionEstadoZurich(payload = {}, base = {}) {
  const estado = homologarEstadoZurich(payload.estado);
  const out = { ...payload, estado };
  if (fechaVacia(out.fechaInspeccionado)) {
    out.fechaInspeccionado =
      out.fechaAnalisisCaso || base.fechaAnalisisCaso || out.fechaInspeccion || base.fechaInspeccion || null;
  }
  if (fechaVacia(out.fechaLiquidado)) {
    out.fechaLiquidado =
      out.fechaCasoParaPago ||
      out.fechaAutorizacionAnalista ||
      base.fechaCasoParaPago ||
      base.fechaAutorizacionAnalista ||
      base.fechaLiquidado ||
      null;
  }
  const clave = campoFechaPorEstadoZurich(estado);
  const anterior = homologarEstadoZurich(base.estado);
  if (clave && fechaVacia(out[clave]) && fechaVacia(base[clave]) && anterior !== estado) {
    out[clave] = new Date();
  }
  if (estado === ESTADO_ZURICH_DEFAULT && fechaVacia(out.fechaCasoNuevo)) {
    out.fechaCasoNuevo = base.fechaCasoNuevo || new Date();
  }
  if (estado === 'INSPECCIONADO' && fechaVacia(out.fechaInspeccion)) {
    out.fechaInspeccion = out.fechaInspeccionado || base.fechaInspeccion || new Date();
  }
  if (estado === 'LIQUIDADO' && fechaVacia(out.fechaLiquidado)) {
    out.fechaLiquidado = out.fechaCasoParaPago || base.fechaLiquidado || new Date();
  }
  return out;
}
