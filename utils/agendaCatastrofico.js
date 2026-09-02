/** Campos y utilidades de la agenda CAT (franjas de coordinación / inspección). */

export const HORA_INICIO_AGENDA = 7;
export const HORA_FIN_AGENDA = 19;

export function aplicarCamposAgendaCatastrofico(schema) {
  if (!schema || schema._agendaCatastroficoCampos) return;
  schema._agendaCatastroficoCampos = true;
  schema.add({
    horaInicioCoordinacion: { type: String, default: '' },
    horaFinCoordinacion: { type: String, default: '' },
  });
}

export function ymdBogota(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    return value.trim().slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* fallback local */
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizarHora(valor, fallback = '') {
  const texto = String(valor ?? '').trim();
  if (!texto) return fallback || '';
  const match = texto.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback || '';
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    return fallback || '';
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function horaAMinutos(hora) {
  const n = normalizarHora(hora);
  if (!n) return null;
  const [h, m] = n.split(':').map(Number);
  return h * 60 + m;
}

export function minutosAHora(minutos) {
  const m = Math.max(0, Math.min(24 * 60, Number(minutos) || 0));
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function mapearFranjaAgenda(data = {}, base = {}, pickStr) {
  const pick =
    typeof pickStr === 'function'
      ? pickStr
      : (incoming, existing) =>
          incoming === undefined ? existing ?? '' : incoming == null ? '' : String(incoming);
  return {
    horaInicioCoordinacion: normalizarHora(
      pick(data.horaInicioCoordinacion, base.horaInicioCoordinacion ?? ''),
      ''
    ),
    horaFinCoordinacion: normalizarHora(
      pick(data.horaFinCoordinacion, base.horaFinCoordinacion ?? ''),
      ''
    ),
  };
}

export function franjaValida(horaInicio, horaFin) {
  const ini = horaAMinutos(horaInicio);
  const fin = horaAMinutos(horaFin);
  if (ini == null || fin == null) return false;
  return fin > ini;
}

export function rangosSeSolapan(aIni, aFin, bIni, bFin) {
  return aIni < bFin && bIni < aFin;
}

export function normNombrePersona(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function instanteBogota(ymd, hora) {
  const dia = ymdBogota(ymd);
  const hhmm = normalizarHora(hora);
  if (!dia || !hhmm) return null;
  const date = new Date(`${dia}T${hhmm}:00.000-05:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function fechaAgendaDeCaso(caso = {}) {
  return caso.fechaCoordinandoInspeccion || caso.fechaInspeccion || null;
}

export class ConflictoAgendaError extends Error {
  constructor(mensaje, conflictos = []) {
    super(mensaje);
    this.name = 'ConflictoAgendaError';
    this.status = 409;
    this.conflictos = conflictos;
  }
}

export function responderSiConflictoAgenda(error, res) {
  if (error?.name !== 'ConflictoAgendaError') return false;
  res.status(409).json({
    success: false,
    error: error.message,
    conflictos: error.conflictos || [],
  });
  return true;
}
