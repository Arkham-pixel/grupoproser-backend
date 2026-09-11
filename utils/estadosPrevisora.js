/** Estados operativos Previsora (flujo vigente). */
export const ESTADOS_PREVISORA = [
  'CASO NUEVO',
  'CASO INSPECCIONADO',
  'PENDIENTE DE DOCUMENTOS',
  'AUTORIZACIÓN ANALISTA',
  'PRESENTACIÓN DE CIFRAS',
  'OBJECIÓN',
  'DESISTIMIENTO',
  'CASO CERRADO',
];

export const ESTADO_PREVISORA_DEFAULT = 'CASO NUEVO';

export const FECHA_ACCION_POR_ESTADO_PREVISORA = {
  'CASO NUEVO': 'fechaCasoNuevo',
  'CASO INSPECCIONADO': 'fechaCasoInspeccionado',
  'PENDIENTE DE DOCUMENTOS': 'fechaSolicitudDocumento',
  'AUTORIZACIÓN ANALISTA': 'fechaAutorizacionAnalista',
  'PRESENTACIÓN DE CIFRAS': 'fechaPresentacionCifras',
  OBJECIÓN: 'fechaObjecion',
  DESISTIMIENTO: 'fechaDesistimiento',
  'CASO CERRADO': 'fechaCasoCerrado',
};

/** Fechas legado que se espejan para agenda, boletines e importaciones. */
const ESPEJO_FECHA_LEGADO = {
  fechaCasoInspeccionado: 'fechaCoordinandoInspeccion',
  fechaPresentacionCifras: 'fechaAnalisisCaso',
  fechaCasoCerrado: 'fechaCasoParaPago',
};

const LEGACY = {
  PENDIENTE: 'CASO NUEVO',
  AVISADO: 'CASO NUEVO',
  'EN INSPECCION': 'CASO INSPECCIONADO',
  'COORDINANDO INSPECCION': 'CASO INSPECCIONADO',
  INSPECCIONADO: 'CASO INSPECCIONADO',
  'EN AJUSTE': 'PRESENTACIÓN DE CIFRAS',
  'ANALISIS DEL CASO': 'PRESENTACIÓN DE CIFRAS',
  DOCUMENTACION: 'PENDIENTE DE DOCUMENTOS',
  'PENDIENTE DE DOCUMENTO': 'PENDIENTE DE DOCUMENTOS',
  LIQUIDADO: 'CASO CERRADO',
  'ENVIADO ASEGURADORA': 'CASO CERRADO',
  'CASO PARA PAGO': 'CASO CERRADO',
  CERRADO: 'CASO CERRADO',
  'CERRADO MANUAL': 'CASO CERRADO',
  DESISTIDO: 'DESISTIMIENTO',
  ANULADO: 'DESISTIMIENTO',
};

const sinAcentos = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

export function homologarEstadoPrevisora(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return ESTADO_PREVISORA_DEFAULT;
  if (ESTADOS_PREVISORA.includes(raw)) return raw;
  const key = sinAcentos(raw);
  const exacto = ESTADOS_PREVISORA.find((est) => sinAcentos(est) === key);
  if (exacto) return exacto;
  return LEGACY[key] || raw;
}

function fechaVacia(valor) {
  if (valor == null || valor === '') return true;
  if (valor instanceof Date) return Number.isNaN(valor.getTime());
  return false;
}

export function aplicarFechaAccionEstadoPrevisora(payload = {}, base = {}) {
  const estado = homologarEstadoPrevisora(payload.estado);
  const out = { ...payload, estado };
  const clave = FECHA_ACCION_POR_ESTADO_PREVISORA[estado];
  const anterior = homologarEstadoPrevisora(base.estado);
  if (clave && fechaVacia(out[clave]) && anterior !== estado) {
    out[clave] = new Date();
  }
  if (estado === ESTADO_PREVISORA_DEFAULT && fechaVacia(out.fechaCasoNuevo)) {
    out.fechaCasoNuevo = out.fechaCasoNuevo || base.fechaCasoNuevo || new Date();
  }
  for (const [nuevo, legado] of Object.entries(ESPEJO_FECHA_LEGADO)) {
    if (!fechaVacia(out[nuevo]) && fechaVacia(out[legado])) {
      out[legado] = out[nuevo];
    }
    if (fechaVacia(out[nuevo]) && !fechaVacia(out[legado] ?? base[legado])) {
      out[nuevo] = out[legado] || base[legado];
    }
  }
  return out;
}
