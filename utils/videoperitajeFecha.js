/**
 * Fecha/hora de videoperitaje siempre en America/Bogota (UTC-5, sin DST).
 */

const TZ = 'America/Bogota';
const OFFSET_MS = 5 * 60 * 60 * 1000; // Bogota = UTC-5

/**
 * Interpreta valor de programación.
 * - ISO con Z/offset → instante absoluto
 * - "YYYY-MM-DDTHH:mm" (datetime-local) → hora de pared en Bogotá
 */
export function parseProgramadaAtBogota(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  const s = String(raw).trim();
  if (!s) return null;

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/
  );
  if (m) {
    const utcMs =
      Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6] || 0)
      ) + OFFSET_MS;
    return new Date(utcMs);
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Texto legible para WhatsApp / UI: "30/9/2026, 3:00 p. m." */
export function formatFechaHoraBogota(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-CO', {
    timeZone: TZ,
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export const VIDEOPERITAJE_TZ = TZ;
