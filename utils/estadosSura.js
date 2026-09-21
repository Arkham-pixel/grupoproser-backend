export const ESTADOS_SURA = [
  'CASO NUEVO',
  'ASIGNADO (PARA ASIGNAR INSPECTOR)',
  'INSPECCIONADO',
  'INFORME DEL INSPECTOR',
  'INFORME PRELIMINAR Y/O ACTUALIZACIÓN',
  'INFORME ÚNICO O FINAL',
  'EN PROCESO DE FACTURACIÓN',
  'FACTURADO',
  'ANULADO',
  'DESISTIDO',
  'OBJETADO',
  'CANCELADO SURA',
];

export const ESTADOS_SURA_CERRADOS = [
  'ANULADO',
  'CERRADO',
  'DESISTIDO',
  'OBJETADO',
  'CANCELADO SURA',
];

export const FECHA_ACCION_POR_ESTADO_SURA = {
  'EN PROCESO DE FACTURACIÓN': 'fchaEnProcesoFacturacion',
  FACTURADO: 'fchaFacturado',
};

const MAPA_LEGADO = {
  PENDIENTE: 'CASO NUEVO',
  'EN INSPECCION': 'ASIGNADO (PARA ASIGNAR INSPECTOR)',
  'EN INSPECCIÓN': 'ASIGNADO (PARA ASIGNAR INSPECTOR)',
  DOCUMENTACION: 'INFORME DEL INSPECTOR',
  DOCUMENTACIÓN: 'INFORME DEL INSPECTOR',
  LIQUIDADO: 'INFORME ÚNICO O FINAL',
  'ENVIADO ASEGURADORA': 'INFORME ÚNICO O FINAL',
  CERRADO: 'INFORME ÚNICO O FINAL',
  DESISTIMIENTO: 'DESISTIDO',
  OBJECIÓN: 'OBJETADO',
  OBJECION: 'OBJETADO',
  'CANCELADO SURA': 'CANCELADO SURA',
  CANCELADO: 'CANCELADO SURA',
};

function norm(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function normalizarEstadoSura(valor) {
  const raw = String(valor ?? '').trim();
  if (!raw) return 'CASO NUEVO';
  if (ESTADOS_SURA.includes(raw)) return raw;
  const mapeado = MAPA_LEGADO[raw] || MAPA_LEGADO[norm(raw)];
  if (mapeado) return mapeado;
  const hit = ESTADOS_SURA.find((e) => norm(e) === norm(raw));
  if (hit) return hit;
  const clave = norm(raw);
  if (clave.includes('DESIST') || clave.includes('DADO DE BAJA') || clave.includes('BAJA POR')) {
    return 'DESISTIDO';
  }
  if (clave.includes('OBJET') || clave.includes('OBJECI')) return 'OBJETADO';
  if (clave.includes('ANULAD')) return 'ANULADO';
  if (clave.includes('CANCELADO')) return 'CANCELADO SURA';
  return raw;
}

export function esEstadoSuraCerrado(valor) {
  const n = normalizarEstadoSura(valor);
  return ESTADOS_SURA_CERRADOS.includes(n) || norm(valor) === 'CERRADO';
}

export const ESTADO_SURA_INFORME_UNICO = 'INFORME ÚNICO O FINAL';

function tipoInformeSura(valor) {
  const t = String(valor ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
  if (t === 'preliminar' || t === 'final' || t === 'unico') return t;
  return '';
}

/** Único/final pasan el caso a INFORME ÚNICO O FINAL (equivalente a liquidado).
 *  Preliminar pasa a INFORME PRELIMINAR Y/O ACTUALIZACIÓN (sin bajar de único/final). */
export function estadoSuraPorTipoInforme(tipoInforme, estadoActual) {
  const tipo = tipoInformeSura(tipoInforme);
  const actual = normalizarEstadoSura(estadoActual);
  if (actual === 'ANULADO' || actual === 'DESISTIDO' || actual === 'OBJETADO' || actual === 'CANCELADO SURA') {
    return actual;
  }
  if (actual === 'EN PROCESO DE FACTURACIÓN' || actual === 'FACTURADO') {
    return actual;
  }
  if (tipo === 'unico' || tipo === 'final') return ESTADO_SURA_INFORME_UNICO;
  if (tipo === 'preliminar') {
    if (actual === ESTADO_SURA_INFORME_UNICO) return actual;
    return 'INFORME PRELIMINAR Y/O ACTUALIZACIÓN';
  }
  return actual;
}

export function aplicarEstadoDesdeTipoInformeSura(payload = {}, base = {}) {
  const estadoEnviado = payload.estado;
  const estadoBase = base.estado;
  if (
    estadoEnviado != null &&
    String(estadoEnviado).trim() !== '' &&
    normalizarEstadoSura(estadoEnviado) !== normalizarEstadoSura(estadoBase)
  ) {
    return aplicarFechaAccionEstadoSura(aplicarFechasHitoDesdeInformeUnicoSura(payload, base), base);
  }
  const tipo = payload?.informeUnico?.tipoInforme ?? base?.informeUnico?.tipoInforme;
  const siguiente = estadoSuraPorTipoInforme(tipo, payload.estado || base.estado);
  let next = payload;
  if (siguiente && siguiente !== normalizarEstadoSura(payload.estado || base.estado)) {
    next = {
      ...payload,
      estado: siguiente,
      descripcionEstado: siguiente,
    };
  }
  return aplicarFechaAccionEstadoSura(aplicarFechasHitoDesdeInformeUnicoSura(next, base), base);
}

function fechaVaciaSura(valor) {
  if (valor == null || valor === '') return true;
  if (valor instanceof Date) return Number.isNaN(valor.getTime());
  return typeof valor === 'string' && !valor.trim();
}

export function aplicarFechaAccionEstadoSura(payload = {}, base = {}) {
  const estado = normalizarEstadoSura(payload.estado || payload.descripcionEstado);
  const out = { ...payload, estado };
  const clave = FECHA_ACCION_POR_ESTADO_SURA[estado];
  const anterior = normalizarEstadoSura(base.estado || base.descripcionEstado);
  if (clave && fechaVaciaSura(out[clave]) && anterior !== estado) {
    out[clave] = new Date();
  }
  return out;
}

/**
 * Al guardar el informe, rellena fchaInfoPrelm / fchaInfoFnal (trazabilidad)
 * si están vacías — es la misma fecha del informe, no hay que digitarla a mano.
 */
export function aplicarFechasHitoDesdeInformeUnicoSura(payload = {}, base = {}) {
  const informe = payload.informeUnico ?? base.informeUnico;
  if (!informe || typeof informe !== 'object') return payload;
  const tipo = tipoInformeSura(informe.tipoInforme);
  const out = { ...payload };
  const fechaInforme = informe.fechaInforme || null;
  const fechaPrelimGuardada = informe.fechaInformePreliminar || null;

  const prelimActual = out.fchaInfoPrelm ?? base.fchaInfoPrelm;
  if (!prelimActual) {
    if (tipo === 'preliminar' && fechaInforme) {
      out.fchaInfoPrelm = fechaInforme;
    } else if (fechaPrelimGuardada) {
      out.fchaInfoPrelm = fechaPrelimGuardada;
    }
  }

  const finalActual = out.fchaInfoFnal ?? base.fchaInfoFnal;
  if (!finalActual && (tipo === 'final' || tipo === 'unico') && fechaInforme) {
    out.fchaInfoFnal = fechaInforme;
  }

  // Conservar fecha preliminar dentro del bloque informe aunque cambien a final.
  if (tipo === 'preliminar' && fechaInforme) {
    out.informeUnico = {
      ...informe,
      fechaInformePreliminar: fechaPrelimGuardada || fechaInforme,
    };
  } else if (fechaPrelimGuardada && !informe.fechaInformePreliminar) {
    out.informeUnico = { ...informe, fechaInformePreliminar: fechaPrelimGuardada };
  }

  return out;
}
