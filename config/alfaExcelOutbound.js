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

/** Backoff: 1m, 5m, 15m, 1h */
export const ALFA_EXCEL_OUTBOUND_RETRY_MS = Object.freeze([
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
]);

export function getAlfaExcelOutboundConfig() {
  return Object.freeze({
    cronEnabled: boolEnv('SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED', false),
    cronSchedule: String(
      process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_CRON || '*/2 * * * *'
    ).trim(),
    batchSize: (() => {
      const n = parseInt(process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_BATCH_SIZE || '', 10);
      return Number.isFinite(n) && n > 0 ? n : 10;
    })(),
    maxAttempts: (() => {
      const n = parseInt(process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_MAX_ATTEMPTS || '', 10);
      return Number.isFinite(n) && n > 0 ? n : 5;
    })(),
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
