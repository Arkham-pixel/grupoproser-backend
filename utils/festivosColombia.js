/**
 * Festivos de Colombia (fijos + traslados comunes).
 * Fase 2: días hábiles del protocolo excluyen sábado, domingo y festivo.
 */

const FESTIVOS_FIJOS_MM_DD = [
  '01-01', // Año Nuevo
  '05-01', // Día del Trabajo
  '07-20', // Independencia
  '08-07', // Batalla de Boyacá
  '12-08', // Inmaculada
  '12-25', // Navidad
];

/** Festivos con fecha completa (Semana Santa, Reyes, etc.) */
const FESTIVOS_FECHA_COMPLETA = new Set([
  // 2025
  '2025-01-06', '2025-03-24', '2025-04-17', '2025-04-18', '2025-06-02',
  '2025-06-23', '2025-06-30', '2025-08-18', '2025-10-13', '2025-11-03',
  '2025-11-17',
  // 2026
  '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01',
  '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29', '2026-08-17',
  '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08',
  // 2027 (parcial)
  '2027-01-11', '2027-03-25', '2027-03-26',
]);

function formatearClaveFecha(fecha) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function esFestivoColombia(fecha) {
  const f = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(f.getTime())) return false;

  const clave = formatearClaveFecha(f);
  if (FESTIVOS_FECHA_COMPLETA.has(clave)) return true;

  const mmdd = `${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
  return FESTIVOS_FIJOS_MM_DD.includes(mmdd);
}

export function esDiaHabilColombia(fecha) {
  const f = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(f.getTime())) return false;
  const dia = f.getDay();
  if (dia === 0 || dia === 6) return false;
  return !esFestivoColombia(f);
}

export function diasHabilesColombiaEntre(inicio, fin) {
  const a = new Date(inicio);
  const b = new Date(fin);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;

  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);

  let count = 0;
  const cursor = new Date(a);
  while (cursor < b) {
    if (esDiaHabilColombia(cursor)) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}
