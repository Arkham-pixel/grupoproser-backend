/**
 * Configuración importación pólizas Alfa: SharePoint → S3 → AlfaPolicyDocument.
 * Cron deshabilitado por defecto.
 *
 * Ruta fija (con tilde): SEGUROS ALFA/PÓLIZAS
 */

import {
  ALFA_POLICY_IMPORT_PREFIX,
  assertAlfaPolicyImportRoot,
} from '../utils/alfaPolicySharePointPath.js';

function intEnv(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boolEnv(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

export function getAlfaPolicyImportConfig() {
  const rawRoot = String(
    process.env.SHAREPOINT_ALFA_POLICY_IMPORT_ROOT || ALFA_POLICY_IMPORT_PREFIX
  ).trim();

  let rootPath = ALFA_POLICY_IMPORT_PREFIX;
  try {
    rootPath = assertAlfaPolicyImportRoot(rawRoot);
  } catch (error) {
    // Si el .env apunta a POLIZAS sin tilde u otra ruta, forzar la correcta y loguear.
    console.warn(
      JSON.stringify({
        event: 'Alfa policy import root overridden',
        configured: rawRoot,
        using: ALFA_POLICY_IMPORT_PREFIX,
        code: error?.code,
        message: error?.message,
      })
    );
    rootPath = ALFA_POLICY_IMPORT_PREFIX;
  }

  return Object.freeze({
    /** Cron import OFF por defecto — no activar hasta que Alfa cree carpetas. */
    cronEnabled: boolEnv('SHAREPOINT_ALFA_POLICY_IMPORT_ENABLED', false),
    cronSchedule: String(
      process.env.SHAREPOINT_ALFA_POLICY_IMPORT_CRON || '*/5 * * * *'
    ).trim(),
    batchSize: intEnv('SHAREPOINT_ALFA_POLICY_IMPORT_BATCH_SIZE', 20),
    /** Exacto: SEGUROS ALFA/PÓLIZAS */
    rootPath,
    s3KeyPrefix: 'seguros-alfa/polizas',
  });
}

/** Snapshot seguro para health (sin secretos). */
export function getAlfaPolicyImportHealthSnapshot() {
  const cfg = getAlfaPolicyImportConfig();
  return {
    enabled: cfg.cronEnabled,
    cron: cfg.cronSchedule,
    batchSize: cfg.batchSize,
    rootPath: cfg.rootPath,
  };
}
