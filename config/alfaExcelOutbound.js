/**
 * Config outbound ARNALD → Excel Control y Seguimiento.
 * Default OFF — no activar hasta pasar piloto.
 */

import { toAlfaExcelOperationalFileName } from '../utils/alfaExcelSharePointPath.js';

function boolEnv(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

/** Backoff: 30s, 2m, 5m, 15m */
export const ALFA_EXCEL_OUTBOUND_RETRY_MS = Object.freeze([
  30_000,
  2 * 60_000,
  5 * 60_000,
  15 * 60_000,
]);

export function getAlfaExcelOutboundConfig() {
  return Object.freeze({
    cronEnabled: boolEnv('SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED', false),
    cronSchedule: String(
      process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_CRON || '* * * * *'
    ).trim(),
    batchSize: (() => {
      const n = parseInt(process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_BATCH_SIZE || '', 10);
      return Number.isFinite(n) && n > 0 ? n : 25;
    })(),
    maxAttempts: (() => {
      const n = parseInt(process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_MAX_ATTEMPTS || '', 10);
      return Number.isFinite(n) && n > 0 ? n : 8;
    })(),
    /**
     * Reconciliación periódica: compara estado ARNALD vs Excel y reencola gaps
     * (evita casos CERRADO/OBJETADO/DESISTIDO/LIQUIDADO desfasados).
     * También append de filas faltantes.
     */
    reconcileEnabled: boolEnv(
      'SHAREPOINT_ALFA_EXCEL_ESTADO_RECONCILE_ENABLED',
      boolEnv('SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED', false)
    ),
    reconcileSchedule: String(
      process.env.SHAREPOINT_ALFA_EXCEL_ESTADO_RECONCILE_CRON || '*/5 * * * *'
    ).trim(),
    integrationKey: 'alfa-excel-control-seguimiento',
    rootPath: String(
      process.env.SHAREPOINT_ALFA_EXCEL_IMPORT_PATH ||
        'SEGUROS ALFA/CONTROL Y SEGUIMIENTO'
    ).trim(),
    // Operativo: nunca *_Final.xlsx (copia de revisión humana)
    fileName: toAlfaExcelOperationalFileName(
      process.env.SHAREPOINT_ALFA_EXCEL_FILE_NAME || ''
    ),
  });
}

export function nextOutboundRetryAt(attempts) {
  const idx = Math.min(Math.max(0, attempts - 1), ALFA_EXCEL_OUTBOUND_RETRY_MS.length - 1);
  return new Date(Date.now() + ALFA_EXCEL_OUTBOUND_RETRY_MS[idx]);
}
