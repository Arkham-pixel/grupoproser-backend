/** Estados operativos Zurich (flujo propio, distinto de Alfa/BBVA). */
export const ESTADO_ZURICH_DEFAULT = 'CASO NUEVO';
export const ESTADO_ZURICH_ASIGNADO = 'ASIGNADO';
export const ESTADO_ZURICH_INSPECCION_COORDINADA = 'INSPECCIÓN COORDINADA';
export const ESTADO_ZURICH_ANALISIS = 'ANALISIS DEL CASO';
export const ESTADO_ZURICH_PENDIENTE_DOCS = 'PENDIENTE DOCUMENTOS (INFORME PRELIMINAR)';
export const ESTADO_ZURICH_LIQUIDAR = 'LIQUIDAR (INFORME UNICO / FINAL)';
export const ESTADO_ZURICH_AUTORIDAD_DELEGADA = 'AUTORIDAD DELEGADA';
export const ESTADO_ZURICH_ACEPTACION_CLIENTE = 'ACEPTACIÓN CLIENTE';
export const ESTADO_ZURICH_FINALIZADO = 'FINALIZADO';

export const ESTADOS_ZURICH = [
  ESTADO_ZURICH_DEFAULT,
  ESTADO_ZURICH_ASIGNADO,
  ESTADO_ZURICH_INSPECCION_COORDINADA,
  ESTADO_ZURICH_ANALISIS,
  ESTADO_ZURICH_PENDIENTE_DOCS,
  ESTADO_ZURICH_LIQUIDAR,
  ESTADO_ZURICH_AUTORIDAD_DELEGADA,
  ESTADO_ZURICH_ACEPTACION_CLIENTE,
  ESTADO_ZURICH_FINALIZADO,
];

export const FECHA_ACCION_POR_ESTADO_ZURICH = {
  [ESTADO_ZURICH_DEFAULT]: 'fechaCasoNuevo',
  [ESTADO_ZURICH_ASIGNADO]: 'fechaAsignacion',
  [ESTADO_ZURICH_INSPECCION_COORDINADA]: 'fechaCoordinandoInspeccion',
  [ESTADO_ZURICH_ANALISIS]: 'fechaAnalisisCaso',
  [ESTADO_ZURICH_PENDIENTE_DOCS]: 'fechaInformePreliminar',
  [ESTADO_ZURICH_LIQUIDAR]: 'fechaInformeFinal',
  [ESTADO_ZURICH_AUTORIDAD_DELEGADA]: 'fechaAutoridadDelegada',
  [ESTADO_ZURICH_ACEPTACION_CLIENTE]: 'fechaAceptacionCliente',
  [ESTADO_ZURICH_FINALIZADO]: 'fechaFinalizado',
};

const LEGACY = {
  PENDIENTE: ESTADO_ZURICH_DEFAULT,
  'EN INSPECCION': ESTADO_ZURICH_INSPECCION_COORDINADA,
  'COORDINANDO INSPECCION': ESTADO_ZURICH_INSPECCION_COORDINADA,
  'INSPCCION COODINADA': ESTADO_ZURICH_INSPECCION_COORDINADA,
  'INSPCION COORDINADA': ESTADO_ZURICH_INSPECCION_COORDINADA,
  INSPECCIONADO: ESTADO_ZURICH_ANALISIS,
  VERIFICADO: ESTADO_ZURICH_ANALISIS,
  DOCUMENTACION: ESTADO_ZURICH_PENDIENTE_DOCS,
  'PENDIENTE DE DOCUMENTO': ESTADO_ZURICH_PENDIENTE_DOCS,
  'PENDIENTE DE DOCUMENTOS': ESTADO_ZURICH_PENDIENTE_DOCS,
  'INFORME PRELIMINAR': ESTADO_ZURICH_PENDIENTE_DOCS,
  'INFORME UNICO': ESTADO_ZURICH_LIQUIDAR,
  'INFORME FINAL': ESTADO_ZURICH_LIQUIDAR,
  LIQUIDADO: ESTADO_ZURICH_FINALIZADO,
  OBJECION: ESTADO_ZURICH_FINALIZADO,
  OBJETADO: ESTADO_ZURICH_FINALIZADO,
  'CASO OBJETADO': ESTADO_ZURICH_FINALIZADO,
  'CASO PARA PAGO': ESTADO_ZURICH_FINALIZADO,
  'ENVIADO ASEGURADORA': ESTADO_ZURICH_FINALIZADO,
  'AUTORIZACION ANALISTA': ESTADO_ZURICH_AUTORIDAD_DELEGADA,
  'AUTORIDAD DELEGADA': ESTADO_ZURICH_AUTORIDAD_DELEGADA,
  'ACEPTACION CLIENTE': ESTADO_ZURICH_ACEPTACION_CLIENTE,
  'ACEPTACION LIQUIDACION': ESTADO_ZURICH_ACEPTACION_CLIENTE,
  CERRADO: ESTADO_ZURICH_FINALIZADO,
};

const sinAcentos = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

const claveBaseEstado = (valor) =>
  sinAcentos(valor)
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function homologarEstadoZurich(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return ESTADO_ZURICH_DEFAULT;
  if (ESTADOS_ZURICH.includes(raw)) return raw;
  const key = sinAcentos(raw);
  const exacto = ESTADOS_ZURICH.find((est) => sinAcentos(est) === key);
  if (exacto) return exacto;
  const base = claveBaseEstado(raw);
  const porBase = ESTADOS_ZURICH.find((est) => claveBaseEstado(est) === base);
  if (porBase) return porBase;
  return LEGACY[key] || LEGACY[base] || raw;
}

export function esEstadoCerradoZurich(estado) {
  return homologarEstadoZurich(estado) === ESTADO_ZURICH_FINALIZADO;
}

export function esEstadoPendienteDocsZurich(estado) {
  return homologarEstadoZurich(estado) === ESTADO_ZURICH_PENDIENTE_DOCS;
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
  if (fechaVacia(out.fechaAnalisisCaso)) {
    out.fechaAnalisisCaso =
      out.fechaInspeccionado ||
      base.fechaInspeccionado ||
      out.fechaInspeccion ||
      base.fechaInspeccion ||
      out.fechaVerificado ||
      base.fechaVerificado ||
      out.fechaAnalisisCaso ||
      base.fechaAnalisisCaso ||
      null;
  }
  if (fechaVacia(out.fechaInformePreliminar)) {
    out.fechaInformePreliminar =
      out.fechaSolicitudDocumento || base.fechaSolicitudDocumento || out.fechaInformePreliminar || null;
  }
  if (fechaVacia(out.fechaFinalizado) && estado === ESTADO_ZURICH_FINALIZADO) {
    out.fechaFinalizado =
      out.fechaLiquidado ||
      base.fechaLiquidado ||
      out.fechaObjecion ||
      base.fechaObjecion ||
      out.fechaCasoParaPago ||
      base.fechaCasoParaPago ||
      null;
  }
  if (fechaVacia(out.fechaInformeFinal) && estado === ESTADO_ZURICH_LIQUIDAR) {
    out.fechaInformeFinal = out.fechaLiquidado || base.fechaLiquidado || out.fechaInformeFinal || null;
  }
  if (fechaVacia(out.fechaAutoridadDelegada) && estado === ESTADO_ZURICH_AUTORIDAD_DELEGADA) {
    out.fechaAutoridadDelegada =
      out.fechaAutorizacionAnalista || base.fechaAutorizacionAnalista || out.fechaAutoridadDelegada || null;
  }
  if (fechaVacia(out.fechaAceptacionCliente) && estado === ESTADO_ZURICH_ACEPTACION_CLIENTE) {
    out.fechaAceptacionCliente =
      out.fechaAceptacionLiquidacion ||
      base.fechaAceptacionLiquidacion ||
      out.fechaAceptacionCliente ||
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
  if (estado === ESTADO_ZURICH_ANALISIS && fechaVacia(out.fechaInspeccion)) {
    out.fechaInspeccion = out.fechaAnalisisCaso || out.fechaInspeccionado || base.fechaInspeccion || new Date();
  }
  if (estado === ESTADO_ZURICH_FINALIZADO && fechaVacia(out.fechaFinalizado)) {
    out.fechaFinalizado = out.fechaLiquidado || base.fechaFinalizado || new Date();
  }
  return out;
}
