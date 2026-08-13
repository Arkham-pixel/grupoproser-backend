/**
 * Config: detección automática Excel Alfa desde SharePoint (preview only).
 * EXECUTE nunca corre desde cron.
 */

function intEnv(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boolEnv(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

export function getAlfaExcelSharePointImportConfig() {
  return Object.freeze({
    cronEnabled: boolEnv('SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED', false),
    cronSchedule: String(
      process.env.SHAREPOINT_ALFA_EXCEL_IMPORT_CRON || '*/5 * * * *'
    ).trim(),
    batchSize: intEnv('SHAREPOINT_ALFA_EXCEL_IMPORT_BATCH_SIZE', 100),
    rootPath: String(
      process.env.SHAREPOINT_ALFA_EXCEL_IMPORT_PATH ||
        'SEGUROS ALFA/CONTROL Y SEGUIMIENTO'
    ).trim(),
    fileName: String(process.env.SHAREPOINT_ALFA_EXCEL_FILE_NAME || '').trim(),
    /** Clave única del checkpoint (una fuente oficial). */
    integrationKey: 'alfa-excel-control-seguimiento',
  });
}
