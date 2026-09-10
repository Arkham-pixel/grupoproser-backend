/**
 * Catálogos oficiales Seguros Alfa (ejes independientes).
 * - `estadoGestion` (AI): GESTION
 * - `estado` (AJ): SINIESTRO
 */

export const ALFA_ESTADOS_GESTION = Object.freeze([
  'EN GESTIÓN',
  'CONTACTADO/PROGRAMADO',
  'LIQUIDADO',
  'INSPECCIONADO',
  'SIN RESPUESTA EFECTIVA',
]);

export const ALFA_ESTADOS_SINIESTRO = Object.freeze([
  'PENDIENTE',
  'DESISTIDO',
  'CERRADO',
  'OBJETADO',
  'PROCESO DE PAGO',
  'PENDIENTE ACEPTACION CIFRAS',
]);

/**
 * @deprecated Compatibilidad histórica: antes se usaba un solo eje.
 * Mantener como alias del catálogo de siniestro.
 */
export const ALFA_ESTADOS_UNIFICADOS = ALFA_ESTADOS_SINIESTRO;

/** @deprecated Ya no se fuerzan a CERRADO; SharePoint recibe el estado real. */
export const ALFA_ESTADOS_SHAREPOINT_COMO_CERRADO = Object.freeze([]);

/** @deprecated Alias legacy; usar ALFA_ESTADOS_SINIESTRO. */
export const ALFA_KNOWN_STATUSES = ALFA_ESTADOS_UNIFICADOS;

const STATUS_RANK = Object.freeze({
  PENDIENTE: 10,
  'PROCESO DE PAGO': 20,
  'PENDIENTE ACEPTACION CIFRAS': 30,
  CERRADO: 70,
  OBJETADO: 70,
  DESISTIDO: 70,
});

export const ALFA_EXCEL_ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  PENDIENTE: ['PROCESO DE PAGO', 'PENDIENTE ACEPTACION CIFRAS', 'CERRADO', 'OBJETADO', 'DESISTIDO'],
  'PROCESO DE PAGO': ['PENDIENTE ACEPTACION CIFRAS', 'CERRADO', 'OBJETADO', 'DESISTIDO'],
  'PENDIENTE ACEPTACION CIFRAS': ['CERRADO', 'OBJETADO', 'DESISTIDO', 'PROCESO DE PAGO'],
  CERRADO: ['OBJETADO', 'DESISTIDO'],
  OBJETADO: ['DESISTIDO', 'CERRADO'],
  DESISTIDO: ['OBJETADO', 'CERRADO'],
});

export function normalizeAlfaStatus(value) {
  if (value == null || value === '') return '';
  return String(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function canonicalDisplayStatus(normalized) {
  const map = {
    PENDIENTE: 'PENDIENTE',
    'PENDIENTE SINIESTRO': 'PENDIENTE',
    'EN PROCESO DE PAGO': 'PROCESO DE PAGO',
    'PROCESO DE PAGO': 'PROCESO DE PAGO',
    'ENVIADO ASEGURADORA': 'PROCESO DE PAGO',
    LIQUIDADO: 'PENDIENTE ACEPTACION CIFRAS',
    'PENDIENTE ACEPTACION DE CIFRAS': 'PENDIENTE ACEPTACION CIFRAS',
    'PENDIENTE ACEPTACION CIFRAS': 'PENDIENTE ACEPTACION CIFRAS',
    'PENDIENTES ACEPTACION CIFRAS': 'PENDIENTE ACEPTACION CIFRAS',
    CERRADO: 'CERRADO',
    'CERRADO TOTALMENTE': 'CERRADO',
    'CERRADOS TOTALMENTE': 'CERRADO',
    OBJETADO: 'OBJETADO',
    OBJETADOS: 'OBJETADO',
    'CASO OBJETADO': 'OBJETADO',
    OBJECION: 'OBJETADO',
    DESISTIDO: 'DESISTIDO',
    DESISTIDOS: 'DESISTIDO',
    DESISTIMIENTO: 'DESISTIDO',
  };
  return map[normalized] || null;
}

/**
 * Homologa estado SINIESTRO al catálogo oficial Alfa.
 */
export function homologarEstadoSiniestroAlfa(estado, extras = {}) {
  const raw = String(estado || '').trim();
  if (!raw) return 'PENDIENTE';
  if (ALFA_ESTADOS_SINIESTRO.includes(raw)) return raw;
  const n = normalizeAlfaStatus(raw);

  if (n === 'LIQUIDADO') {
    const acep = String(extras?.liquidador?.aceptacionIndemnizacion || '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toUpperCase()
      .replace(/\s+/g, '_');
    if (acep === 'ACEPTO' || extras?.fechaAceptacionLiquidacion) return 'PROCESO DE PAGO';
    return 'PENDIENTE ACEPTACION CIFRAS';
  }

  return canonicalDisplayStatus(n) || 'PENDIENTE';
}

/**
 * Valor de ESTADO SINIESTRO para Excel/SharePoint.
 * Requisito: escribir exactamente la etiqueta de compañía almacenada.
 */
export function estadoAlfaParaSharePoint(estado) {
  return homologarEstadoSiniestroAlfa(estado);
}

/**
 * Homologa estado GESTION al catálogo oficial Alfa.
 */
export function homologarEstadoGestionAlfa(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (ALFA_ESTADOS_GESTION.includes(raw)) return raw;

  const n = normalizeAlfaStatus(raw);
  const aliases = {
    'EN GESTION': 'EN GESTIÓN',
    PENDIENTE: 'EN GESTIÓN',
    'SIN CONTACTAR': 'EN GESTIÓN',
    CONTACTADO: 'CONTACTADO/PROGRAMADO',
    PROGRAMADO: 'CONTACTADO/PROGRAMADO',
    'CONTACTADO Y PROGRAMADO': 'CONTACTADO/PROGRAMADO',
    'CONTACTADO - PROGRAMADO': 'CONTACTADO/PROGRAMADO',
    // Legacy operativo: ya hubo contacto / pedida de docs → no es «por llamar».
    'SOLICITUD DE DOCUMENTOS': 'INSPECCIONADO',
    'EN INSPECCION': 'INSPECCIONADO',
    INSPECCIONADO: 'INSPECCIONADO',
    LIQUIDADO: 'LIQUIDADO',
    'SIN RESPUESTA': 'SIN RESPUESTA EFECTIVA',
    'SIN RESPUESTA EFECTIVA': 'SIN RESPUESTA EFECTIVA',
  };
  return aliases[n] || 'EN GESTIÓN';
}

/**
 * Valor de ESTADO GESTION para Excel/SharePoint.
 * Requisito: escribir exactamente la etiqueta de compañía almacenada.
 */
export function estadoGestionAlfaParaSharePoint(estadoGestion) {
  return homologarEstadoGestionAlfa(estadoGestion);
}

/** Observación que se escribe sola al marcar OBJETADO / DESISTIDO (Excel OBSERVACION). */
export const OBSERVACIONES_AUTO_CIERRE_ALFA = Object.freeze({
  OBJETADO: 'Caso objetado.',
  DESISTIDO: 'Caso desistido.',
});

function normObsAutoAlfa(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

const OBS_AUTO_CIERRE_ALFA_NORM = new Set(
  Object.values(OBSERVACIONES_AUTO_CIERRE_ALFA).map((t) => normObsAutoAlfa(t))
);

export function observacionAutoCierreAlfa(estado) {
  const e = homologarEstadoAlfa(estado);
  return OBSERVACIONES_AUTO_CIERRE_ALFA[e] || '';
}

/**
 * Completa o sustituye la observación automática de OBJETADO/DESISTIDO.
 * No pisa un texto que haya escrito el ajustador.
 */
export function aplicarObservacionAutoCierreAlfa(estado, observacionActual = '') {
  const plantilla = observacionAutoCierreAlfa(estado);
  const actual = String(observacionActual || '').trim();
  const actualEsAuto = !actual || OBS_AUTO_CIERRE_ALFA_NORM.has(normObsAutoAlfa(actual));
  if (plantilla) return actualEsAuto ? plantilla : actual;
  return actualEsAuto ? '' : actual;
}

/** Normaliza texto de gestión para comparar. */
export function normalizeAlfaEstadoGestion(value) {
  if (value == null || value === '') return '';
  return String(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Canoniza estadoGestion (los 5 del correo) o null.
 */
export function canonicalEstadoGestion(value) {
  const canon = homologarEstadoGestionAlfa(value);
  return canon || null;
}

export function isAlfaEstadoDefinido(estado) {
  const n = normalizeAlfaStatus(homologarEstadoSiniestroAlfa(estado));
  return n === 'PROCESO DE PAGO' || n === 'PENDIENTE ACEPTACION CIFRAS' || n === 'CERRADO' || n === 'OBJETADO' || n === 'DESISTIDO';
}

/**
 * Homologa estado SINIESTRO (compatibilidad histórica).
 */
export function homologarEstadoAlfa(valor) {
  return homologarEstadoSiniestroAlfa(valor);
}

/**
 * @deprecated Solo para migración legacy.
 * No usar para sobrescribir `estadoGestion` en flujos normales.
 */
export function estadoGestionDesdeEstadoAlfa(estado) {
  const e = homologarEstadoSiniestroAlfa(estado);
  if (e === 'PENDIENTE') return 'EN GESTIÓN';
  if (e === 'PROCESO DE PAGO') return 'LIQUIDADO';
  if (e === 'PENDIENTE ACEPTACION CIFRAS') return 'LIQUIDADO';
  if (e === 'CERRADO') return 'LIQUIDADO';
  if (e === 'OBJETADO') return 'SIN RESPUESTA EFECTIVA';
  if (e === 'DESISTIDO') return 'SIN RESPUESTA EFECTIVA';
  return 'EN GESTIÓN';
}

/**
 * Deriva estadoGestion desde el caso (compat backfill).
 */
export function deriveEstadoGestionFromCaso(caso = {}) {
  return estadoGestionDesdeEstadoAlfa(
    homologarEstadoAlfa(caso.estado, {
      fechaInspeccion: caso.fechaInspeccion,
      estadoGestion: caso.estadoGestion,
    })
  );
}

/**
 * @returns {{ update: boolean, reason: string, nextStatus?: string|null, warning?: string }}
 */
export function shouldUpdateAlfaStatus({ currentStatus, incomingStatus } = {}) {
  const incomingRaw = incomingStatus == null ? '' : String(incomingStatus).trim();
  if (!incomingRaw) {
    return { update: false, reason: 'EMPTY_INCOMING' };
  }

  const incomingNorm = normalizeAlfaStatus(incomingRaw);
  const currentNorm = normalizeAlfaStatus(currentStatus);

  if (
    /^(N\/?A|NA|NULL|UNDEFINED|-|SIN DATO|POR CONFIRM|PENDIENTE DE INFORM)|^(DESISTE)$/i.test(
      incomingNorm
    )
  ) {
    return { update: false, reason: 'PLACEHOLDER_INCOMING' };
  }

  const displayIncoming = canonicalDisplayStatus(incomingNorm);
  if (!displayIncoming) {
    return {
      update: false,
      reason: 'UNKNOWN_STATUS',
      warning: `Estado Excel desconocido: ${incomingRaw}`,
    };
  }

  if (!currentNorm) {
    return { update: true, reason: 'NO_CURRENT', nextStatus: displayIncoming };
  }

  if (currentNorm === incomingNorm) {
    return { update: false, reason: 'SAME_STATUS', nextStatus: displayIncoming };
  }

  const allowed = ALFA_EXCEL_ALLOWED_STATUS_TRANSITIONS[currentNorm] || [];
  if (allowed.includes(incomingNorm)) {
    return { update: true, reason: 'ALLOWED_TRANSITION', nextStatus: displayIncoming };
  }

  const rankCurrent = STATUS_RANK[currentNorm];
  const rankIncoming = STATUS_RANK[incomingNorm];
  if (
    Number.isFinite(rankCurrent) &&
    Number.isFinite(rankIncoming) &&
    rankIncoming < rankCurrent
  ) {
    return {
      update: false,
      reason: 'REGRESSION_BLOCKED',
      warning: `Transición bloqueada ${currentStatus} → ${incomingRaw}`,
      nextStatus: displayIncoming,
    };
  }

  return {
    update: false,
    reason: 'TRANSITION_NOT_ALLOWED',
    warning: `Transición no permitida ${currentStatus} → ${incomingRaw}`,
    nextStatus: displayIncoming,
  };
}
