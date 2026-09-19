/**
 * Catálogos oficiales Seguros Alfa (ejes independientes).
 * Tipificación Excel / lineamiento compañía:
 * - `estadoGestion` (AI): GESTION
 * - `estado` (AJ): SINIESTRO
 *
 * Relación: cada gestión solo admite ciertos estados de siniestro.
 */

export const ALFA_ESTADOS_GESTION = Object.freeze([
  'PTE CONTACTO',
  'SOLICITUD DTOS',
  'CONTACTADO Y PROGRAMADO',
  'INSPECCIONADO',
  'LIQUIDADO',
  'SIN RESPUESTA EFECTIVA',
  'SIN PÓLIZA',
]);

export const ALFA_ESTADOS_SINIESTRO = Object.freeze([
  'PENDIENTE',
  'INSPECCIONADO PENDIENTE',
  'CERRADO',
  'DESISTIDO',
  'PROCESO DE PAGO',
  'PENDIENTE ACEPTACION CIFRAS',
  'OBJETADO',
  'PAGADO',
]);

/**
 * Relación oficial: Estado de Gestión → Estados de Siniestro permitidos.
 */
export const ALFA_RELACION_GESTION_SINIESTRO = Object.freeze({
  'PTE CONTACTO': Object.freeze(['PENDIENTE']),
  'SOLICITUD DTOS': Object.freeze(['PENDIENTE']),
  'CONTACTADO Y PROGRAMADO': Object.freeze(['PENDIENTE']),
  INSPECCIONADO: Object.freeze(['INSPECCIONADO PENDIENTE', 'CERRADO', 'DESISTIDO']),
  LIQUIDADO: Object.freeze([
    'PROCESO DE PAGO',
    'PENDIENTE ACEPTACION CIFRAS',
    'OBJETADO',
    'PAGADO',
  ]),
  'SIN RESPUESTA EFECTIVA': Object.freeze(['PENDIENTE']),
  'SIN PÓLIZA': Object.freeze(['CERRADO']),
});

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
  'INSPECCIONADO PENDIENTE': 15,
  'PROCESO DE PAGO': 20,
  'PENDIENTE ACEPTACION CIFRAS': 30,
  PAGADO: 60,
  CERRADO: 70,
  OBJETADO: 70,
  DESISTIDO: 70,
});

export const ALFA_EXCEL_ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  PENDIENTE: [
    'INSPECCIONADO PENDIENTE',
    'PROCESO DE PAGO',
    'PENDIENTE ACEPTACION CIFRAS',
    'CERRADO',
    'OBJETADO',
    'DESISTIDO',
    'PAGADO',
  ],
  'INSPECCIONADO PENDIENTE': ['CERRADO', 'DESISTIDO', 'PENDIENTE ACEPTACION CIFRAS', 'PROCESO DE PAGO'],
  'PROCESO DE PAGO': ['PENDIENTE ACEPTACION CIFRAS', 'CERRADO', 'OBJETADO', 'DESISTIDO', 'PAGADO'],
  'PENDIENTE ACEPTACION CIFRAS': ['CERRADO', 'OBJETADO', 'DESISTIDO', 'PROCESO DE PAGO', 'PAGADO'],
  PAGADO: ['CERRADO'],
  CERRADO: ['OBJETADO', 'DESISTIDO'],
  OBJETADO: ['DESISTIDO', 'CERRADO', 'PROCESO DE PAGO'],
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
    'INSPECCIONADO PENDIENTE': 'INSPECCIONADO PENDIENTE',
    'EN PROCESO DE PAGO': 'PROCESO DE PAGO',
    'PROCESO DE PAGO': 'PROCESO DE PAGO',
    'ENVIADO ASEGURADORA': 'PROCESO DE PAGO',
    LIQUIDADO: 'PENDIENTE ACEPTACION CIFRAS',
    'PENDIENTE ACEPTACION DE CIFRAS': 'PENDIENTE ACEPTACION CIFRAS',
    'PENDIENTE ACEPTACION CIFRAS': 'PENDIENTE ACEPTACION CIFRAS',
    'PENDIENTES ACEPTACION CIFRAS': 'PENDIENTE ACEPTACION CIFRAS',
    'PENDIENTE ACEPTACION DE CIFRA': 'PENDIENTE ACEPTACION CIFRAS',
    'PENDIENTE ACEPTACION CIFRA': 'PENDIENTE ACEPTACION CIFRAS',
    'PTE ACEPTACION CIFRAS': 'PENDIENTE ACEPTACION CIFRAS',
    'PTE ACEPTACION DE CIFRAS': 'PENDIENTE ACEPTACION CIFRAS',
    PAGADO: 'PAGADO',
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
    // Etiquetas de GESTIÓN mal puestas en columna ESTADO SINIESTRO → PENDIENTE
    'SIN CONTACTAR': 'PENDIENTE',
    'EN GESTION': 'PENDIENTE',
    'PTE CONTACTO': 'PENDIENTE',
    CONTACTADO: 'PENDIENTE',
    'CONTACTADO Y PROGRAMADO': 'PENDIENTE',
    'CONTACTADO - PROGRAMADO': 'PENDIENTE',
    'CONTACTADO/PROGRAMADO': 'PENDIENTE',
    'SOLICITUD DE DOCUMENTOS': 'PENDIENTE',
    'SOLICITUD DTOS': 'PENDIENTE',
    INSPECCIONADO: 'INSPECCIONADO PENDIENTE',
    'EN INSPECCION': 'INSPECCIONADO PENDIENTE',
    'SIN RESPUESTA': 'PENDIENTE',
    'SIN RESPUESTA EFECTIVA': 'PENDIENTE',
    'SIN POLIZA': 'CERRADO',
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
    'EN GESTION': 'PTE CONTACTO',
    PENDIENTE: 'PTE CONTACTO',
    'SIN CONTACTAR': 'PTE CONTACTO',
    'PTE CONTACTO': 'PTE CONTACTO',
    'PENDIENTE DE CONTACTO': 'PTE CONTACTO',
    'PENDIENTE DE CONTACTO Y SOLICITUD DE DOCUMENTOS': 'PTE CONTACTO',
    CONTACTADO: 'CONTACTADO Y PROGRAMADO',
    PROGRAMADO: 'CONTACTADO Y PROGRAMADO',
    'CONTACTADO Y PROGRAMADO': 'CONTACTADO Y PROGRAMADO',
    'CONTACTADO - PROGRAMADO': 'CONTACTADO Y PROGRAMADO',
    'CONTACTADO/PROGRAMADO': 'CONTACTADO Y PROGRAMADO',
    'SOLICITUD DE DOCUMENTOS': 'SOLICITUD DTOS',
    'SOLICITUD DTOS': 'SOLICITUD DTOS',
    'SOLICITUD DOCUMENTOS': 'SOLICITUD DTOS',
    'EN INSPECCION': 'INSPECCIONADO',
    INSPECCIONADO: 'INSPECCIONADO',
    LIQUIDADO: 'LIQUIDADO',
    'SIN RESPUESTA': 'SIN RESPUESTA EFECTIVA',
    'SIN RESPUESTA EFECTIVA': 'SIN RESPUESTA EFECTIVA',
    'SIN POLIZA': 'SIN PÓLIZA',
    'SIN PÓLIZA': 'SIN PÓLIZA',
    // Legacy: CERRADO como gestión → tipificación actual Sin póliza
    CERRADO: 'SIN PÓLIZA',
    'CERRADO TOTALMENTE': 'SIN PÓLIZA',
    'CERRADOS TOTALMENTE': 'SIN PÓLIZA',
  };
  return aliases[n] || 'PTE CONTACTO';
}

/** True si el valor ya es una etiqueta oficial del catálogo de gestión. */
export function esEstadoGestionCanonicoAlfa(value) {
  const raw = String(value || '').trim();
  return ALFA_ESTADOS_GESTION.includes(raw);
}

/** True si el valor ya es una etiqueta oficial del catálogo de siniestro. */
export function esEstadoSiniestroCanonicoAlfa(value) {
  const raw = String(value || '').trim();
  return ALFA_ESTADOS_SINIESTRO.includes(raw);
}

/**
 * Estados de siniestro permitidos para una gestión dada.
 */
export function estadosSiniestroPermitidosParaGestionAlfa(estadoGestion) {
  const g = homologarEstadoGestionAlfa(estadoGestion);
  return ALFA_RELACION_GESTION_SINIESTRO[g] || ['PENDIENTE'];
}

/**
 * Si el siniestro actual no es válido para la gestión, sugiere el primero permitido.
 */
export function asegurarSiniestroCompatibleConGestionAlfa(estadoGestion, estadoSiniestro, extras = {}) {
  const g = homologarEstadoGestionAlfa(estadoGestion);
  const permitidos = estadosSiniestroPermitidosParaGestionAlfa(g);
  const s = homologarEstadoSiniestroAlfa(estadoSiniestro, extras);
  if (permitidos.includes(s)) return s;
  return permitidos[0] || 'PENDIENTE';
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
 * Canoniza estadoGestion (catálogo oficial de gestión) o null.
 */
export function canonicalEstadoGestion(value) {
  const canon = homologarEstadoGestionAlfa(value);
  return canon || null;
}

export function isAlfaEstadoDefinido(estado) {
  const n = normalizeAlfaStatus(homologarEstadoSiniestroAlfa(estado));
  return (
    n === 'PROCESO DE PAGO' ||
    n === 'PENDIENTE ACEPTACION CIFRAS' ||
    n === 'PAGADO' ||
    n === 'CERRADO' ||
    n === 'OBJETADO' ||
    n === 'DESISTIDO' ||
    n === 'INSPECCIONADO PENDIENTE'
  );
}

/**
 * Homologa estado SINIESTRO (compatibilidad histórica).
 */
export function homologarEstadoAlfa(valor) {
  return homologarEstadoSiniestroAlfa(valor);
}

/**
 * Reglas operativas gestión ← siniestro (flujo oficial):
 * - OBJETADO / PTE ACEPTACION / PROCESO DE PAGO / PAGADO → LIQUIDADO
 * - DESISTIDO / INSPECCIONADO PENDIENTE → INSPECCIONADO
 * - CERRADO → INSPECCIONADO o SIN PÓLIZA (según gestión actual)
 * - PENDIENTE → mantiene gestiones de contacto / sin respuesta
 */
export function sincronizarGestionConCierreSiniestroAlfa(estadoSiniestro, estadoGestion) {
  const s = homologarEstadoSiniestroAlfa(estadoSiniestro);
  const g = homologarEstadoGestionAlfa(estadoGestion);

  if (
    s === 'OBJETADO' ||
    s === 'PENDIENTE ACEPTACION CIFRAS' ||
    s === 'PROCESO DE PAGO' ||
    s === 'PAGADO'
  ) {
    return 'LIQUIDADO';
  }
  if (s === 'DESISTIDO' || s === 'INSPECCIONADO PENDIENTE') {
    return 'INSPECCIONADO';
  }
  if (s === 'CERRADO') {
    if (g === 'SIN PÓLIZA' || g === 'INSPECCIONADO') return g;
    return estadosSiniestroPermitidosParaGestionAlfa(g).includes('CERRADO') ? g : 'INSPECCIONADO';
  }
  if (s === 'PENDIENTE') {
    if (
      g === 'PTE CONTACTO' ||
      g === 'SOLICITUD DTOS' ||
      g === 'CONTACTADO Y PROGRAMADO' ||
      g === 'SIN RESPUESTA EFECTIVA'
    ) {
      return g;
    }
    // Gestión avanzada incompatible con PENDIENTE: conservar tipificación;
    // asegurarSiniestroCompatibleConGestionAlfa ajusta el siniestro.
    if (g === 'INSPECCIONADO' || g === 'LIQUIDADO' || g === 'SIN PÓLIZA') return g;
    return 'PTE CONTACTO';
  }
  return g || 'PTE CONTACTO';
}

/**
 * @deprecated Solo para migración legacy.
 */
export function estadoGestionDesdeEstadoAlfa(estado) {
  return sincronizarGestionConCierreSiniestroAlfa(estado, estado);
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
  if (allowed.includes(incomingNorm) || allowed.includes(displayIncoming)) {
    return { update: true, reason: 'ALLOWED_TRANSITION', nextStatus: displayIncoming };
  }

  const rankCurrent = STATUS_RANK[currentNorm];
  const rankIncoming = STATUS_RANK[incomingNorm] ?? STATUS_RANK[displayIncoming];
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
