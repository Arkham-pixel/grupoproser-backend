/**
 * Estados oficiales Seguros Alfa — un solo eje (`estado`).
 * Une lineamiento correo (gestión) + cierre de liquidación.
 * `estadoGestion` se deriva para Excel AD (ESTADO GESTION).
 */

export const ALFA_ESTADOS_UNIFICADOS = Object.freeze([
  'Sin contactar',
  'Contactado y programado',
  'Inspeccionado',
  'Sin respuesta',
  'Solicitud de documentos',
  'LIQUIDADO',
  'ENVIADO ASEGURADORA',
  'CERRADO',
  'OBJETADO',
  'DESISTIDO',
]);

/** Cierres que en SharePoint (ESTADO SINIESTRO) se escriben como CERRADO. */
export const ALFA_ESTADOS_SHAREPOINT_COMO_CERRADO = Object.freeze(['OBJETADO', 'DESISTIDO']);

/** @deprecated Alias del catálogo unificado. */
export const ALFA_KNOWN_STATUSES = ALFA_ESTADOS_UNIFICADOS;

/** Los 5 del correo (vista Excel AD). */
export const ALFA_ESTADOS_GESTION = Object.freeze([
  'Sin contactar',
  'Contactado y programado',
  'Inspeccionado',
  'Sin respuesta',
  'Solicitud de documentos',
]);

const STATUS_RANK = Object.freeze({
  'SIN CONTACTAR': 10,
  'CONTACTADO Y PROGRAMADO': 20,
  INSPECCIONADO: 30,
  'SIN RESPUESTA': 35,
  'SOLICITUD DE DOCUMENTOS': 40,
  // legacy
  PENDIENTE: 10,
  'EN TRAMITE': 15,
  'EN INSPECCION': 20,
  DOCUMENTACION: 40,
  LIQUIDADO: 50,
  'ENVIADO ASEGURADORA': 60,
  CERRADO: 70,
  OBJETADO: 70,
  DESISTIDO: 70,
});

export const ALFA_EXCEL_ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  'SIN CONTACTAR': [
    'CONTACTADO Y PROGRAMADO',
    'INSPECCIONADO',
    'SIN RESPUESTA',
    'SOLICITUD DE DOCUMENTOS',
    'LIQUIDADO',
    'ENVIADO ASEGURADORA',
    'CERRADO',
    'OBJETADO',
    'DESISTIDO',
  ],
  'CONTACTADO Y PROGRAMADO': [
    'INSPECCIONADO',
    'SIN RESPUESTA',
    'SOLICITUD DE DOCUMENTOS',
    'LIQUIDADO',
    'ENVIADO ASEGURADORA',
    'CERRADO',
    'OBJETADO',
    'DESISTIDO',
  ],
  INSPECCIONADO: [
    'SIN RESPUESTA',
    'SOLICITUD DE DOCUMENTOS',
    'LIQUIDADO',
    'ENVIADO ASEGURADORA',
    'CERRADO',
    'OBJETADO',
    'DESISTIDO',
  ],
  'SIN RESPUESTA': [
    'CONTACTADO Y PROGRAMADO',
    'INSPECCIONADO',
    'SOLICITUD DE DOCUMENTOS',
    'LIQUIDADO',
    'ENVIADO ASEGURADORA',
    'CERRADO',
    'OBJETADO',
    'DESISTIDO',
  ],
  'SOLICITUD DE DOCUMENTOS': [
    'LIQUIDADO',
    'ENVIADO ASEGURADORA',
    'CERRADO',
    'OBJETADO',
    'DESISTIDO',
    'INSPECCIONADO',
  ],
  LIQUIDADO: ['ENVIADO ASEGURADORA', 'CERRADO', 'OBJETADO', 'DESISTIDO'],
  'ENVIADO ASEGURADORA': ['CERRADO', 'OBJETADO', 'DESISTIDO'],
  CERRADO: ['OBJETADO', 'DESISTIDO'],
  OBJETADO: ['DESISTIDO', 'CERRADO'],
  DESISTIDO: ['OBJETADO', 'CERRADO'],
  // legacy keys still accepted in Excel diffs
  PENDIENTE: [
    'EN TRAMITE',
    'EN INSPECCION',
    'DOCUMENTACION',
    'LIQUIDADO',
    'ENVIADO ASEGURADORA',
    'CERRADO',
    'OBJETADO',
    'DESISTIDO',
  ],
  'EN TRAMITE': [
    'EN INSPECCION',
    'DOCUMENTACION',
    'LIQUIDADO',
    'ENVIADO ASEGURADORA',
    'CERRADO',
    'OBJETADO',
    'DESISTIDO',
  ],
  'EN INSPECCION': [
    'DOCUMENTACION',
    'LIQUIDADO',
    'ENVIADO ASEGURADORA',
    'CERRADO',
    'OBJETADO',
    'DESISTIDO',
  ],
  DOCUMENTACION: ['LIQUIDADO', 'ENVIADO ASEGURADORA', 'CERRADO', 'OBJETADO', 'DESISTIDO'],
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
    'SIN CONTACTAR': 'Sin contactar',
    'CONTACTADO Y PROGRAMADO': 'Contactado y programado',
    INSPECCIONADO: 'Inspeccionado',
    'SIN RESPUESTA': 'Sin respuesta',
    'SOLICITUD DE DOCUMENTOS': 'Solicitud de documentos',
    PENDIENTE: 'Sin contactar',
    'EN TRAMITE': 'Contactado y programado',
    'EN INSPECCION': 'Contactado y programado',
    DOCUMENTACION: 'Solicitud de documentos',
    LIQUIDADO: 'LIQUIDADO',
    'ENVIADO ASEGURADORA': 'ENVIADO ASEGURADORA',
    CERRADO: 'CERRADO',
    OBJETADO: 'OBJETADO',
    'CASO OBJETADO': 'OBJETADO',
    OBJECION: 'OBJETADO',
    DESISTIDO: 'DESISTIDO',
    DESISTIMIENTO: 'DESISTIDO',
  };
  return map[normalized] || null;
}

/**
 * Valor de ESTADO SINIESTRO para Excel / SharePoint.
 * OBJETADO y DESISTIDO se reportan como CERRADO; ARNALD conserva el estado real.
 */
export function estadoAlfaParaSharePoint(estado) {
  const n = normalizeAlfaStatus(estado);
  if (!n) return '';
  if (n === 'OBJETADO' || n === 'DESISTIDO' || n === 'CASO OBJETADO' || n === 'OBJECION') {
    return 'CERRADO';
  }
  if (n === 'DESISTIMIENTO') return 'CERRADO';
  const display = canonicalDisplayStatus(n);
  return display || String(estado || '').trim();
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
  const n = normalizeAlfaEstadoGestion(value);
  if (!n) return null;
  const aliases = {
    'sin contactar': 'Sin contactar',
    pendiente: 'Sin contactar',
    'contactado y programado': 'Contactado y programado',
    contactado: 'Contactado y programado',
    programado: 'Contactado y programado',
    inspeccionado: 'Inspeccionado',
    'sin respuesta': 'Sin respuesta',
    'no contesta': 'Sin respuesta',
    'solicitud de documentos': 'Solicitud de documentos',
    documentacion: 'Solicitud de documentos',
    'documentacion pendiente': 'Solicitud de documentos',
  };
  if (aliases[n]) return aliases[n];
  const hit = ALFA_ESTADOS_GESTION.find((e) => normalizeAlfaEstadoGestion(e) === n);
  return hit || null;
}

export function isAlfaEstadoDefinido(estado) {
  const n = normalizeAlfaStatus(estado);
  return (
    n.includes('LIQUIDADO') ||
    n.includes('ENVIADO') ||
    n === 'CERRADO' ||
    n === 'OBJETADO' ||
    n === 'DESISTIDO'
  );
}

/**
 * Homologa cualquier valor legacy / dual al catálogo único.
 */
export function homologarEstadoAlfa(valor, extras = {}) {
  const raw = String(valor || '').trim();
  if (ALFA_ESTADOS_UNIFICADOS.includes(raw)) return raw;

  const eg = canonicalEstadoGestion(extras.estadoGestion);
  const norm = normalizeAlfaStatus(raw);
  const fromCanon = canonicalDisplayStatus(norm);
  if (fromCanon) {
    if (
      (norm === 'EN INSPECCION' || norm === 'EN TRAMITE') &&
      extras.fechaInspeccion
    ) {
      return 'Inspeccionado';
    }
    // Si el workflow viejo era genérico y ya había gestión más precisa, preferir gestión
    if (
      eg &&
      (fromCanon === 'Sin contactar' ||
        fromCanon === 'Contactado y programado' ||
        fromCanon === 'Solicitud de documentos') &&
      !isAlfaEstadoDefinido(fromCanon)
    ) {
      // Preferir gestión si aporta más detalle (p.ej. Sin respuesta)
      if (eg === 'Sin respuesta' || eg === 'Inspeccionado') return eg;
      if (fromCanon === 'Sin contactar' && eg) return eg;
      if (fromCanon === 'Contactado y programado' && eg === 'Inspeccionado') return eg;
    }
    return fromCanon;
  }
  if (eg) return eg;
  return 'Sin contactar';
}

/**
 * Vista Excel AD: solo los 5 del correo.
 */
export function estadoGestionDesdeEstadoAlfa(estado) {
  const e = homologarEstadoAlfa(estado);
  if (isAlfaEstadoDefinido(e)) return 'Inspeccionado';
  if (ALFA_ESTADOS_GESTION.includes(e)) return e;
  return 'Sin contactar';
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
