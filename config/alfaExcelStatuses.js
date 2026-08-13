/**
 * Estados oficiales Seguros Alfa (UI) + variantes vistas en datos/tests.
 * Matriz: solo avances de workflow; nunca retroceso automático desde Excel.
 */

export const ALFA_KNOWN_STATUSES = Object.freeze([
  'PENDIENTE',
  'EN INSPECCIÓN',
  'EN INSPECCION', // variante sin tilde (normalizada internamente)
  'EN TRAMITE', // legacy/tests
  'DOCUMENTACIÓN',
  'DOCUMENTACION',
  'LIQUIDADO',
  'ENVIADO ASEGURADORA',
  'CERRADO',
]);

/** Orden de workflow (mayor = más avanzado). */
const STATUS_RANK = Object.freeze({
  PENDIENTE: 10,
  'EN TRAMITE': 15,
  'EN INSPECCION': 20,
  DOCUMENTACION: 30,
  LIQUIDADO: 40,
  'ENVIADO ASEGURADORA': 50,
  CERRADO: 60,
});

/**
 * Transiciones explícitamente permitidas (origen → destinos).
 * Claves y valores ya normalizados (sin tildes, upper).
 */
export const ALFA_EXCEL_ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  PENDIENTE: [
    'EN TRAMITE',
    'EN INSPECCION',
    'DOCUMENTACION',
    'LIQUIDADO',
    'ENVIADO ASEGURADORA',
    'CERRADO',
  ],
  'EN TRAMITE': [
    'EN INSPECCION',
    'DOCUMENTACION',
    'LIQUIDADO',
    'ENVIADO ASEGURADORA',
    'CERRADO',
  ],
  'EN INSPECCION': [
    'DOCUMENTACION',
    'LIQUIDADO',
    'ENVIADO ASEGURADORA',
    'CERRADO',
  ],
  DOCUMENTACION: ['LIQUIDADO', 'ENVIADO ASEGURADORA', 'CERRADO'],
  LIQUIDADO: ['ENVIADO ASEGURADORA', 'CERRADO'],
  'ENVIADO ASEGURADORA': ['CERRADO'],
  CERRADO: [],
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
    'EN TRAMITE': 'EN TRAMITE',
    'EN INSPECCION': 'EN INSPECCIÓN',
    DOCUMENTACION: 'DOCUMENTACIÓN',
    LIQUIDADO: 'LIQUIDADO',
    'ENVIADO ASEGURADORA': 'ENVIADO ASEGURADORA',
    CERRADO: 'CERRADO',
  };
  return map[normalized] || null;
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

  // Placeholders (no pisan estado válido)
  if (
    /^(N\/?A|NA|NULL|UNDEFINED|DESISTE|-|SIN DATO|POR CONFIRM|PENDIENTE DE INFORM)/i.test(
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
    };
  }

  return {
    update: false,
    reason: 'TRANSITION_NOT_ALLOWED',
    warning: `Transición no permitida ${currentStatus} → ${incomingRaw}`,
  };
}
