/**
 * Config importación Excel Seguros Alfa.
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

export function getAlfaExcelImportConfig() {
  return Object.freeze({
    batchSize: intEnv('ALFA_EXCEL_IMPORT_BATCH_SIZE', 100),
    sessionTtlHours: intEnv('ALFA_EXCEL_IMPORT_SESSION_TTL_HOURS', 2),
    maxFileBytes: intEnv('ALFA_EXCEL_IMPORT_MAX_BYTES', 15 * 1024 * 1024),
    maxRows: intEnv('ALFA_EXCEL_IMPORT_MAX_ROWS', 5000),
    /** Ruta SharePoint Control y Seguimiento (detección automática). */
    sharePointExcelPath: String(
      process.env.SHAREPOINT_ALFA_EXCEL_IMPORT_PATH ||
        'SEGUROS ALFA/CONTROL Y SEGUIMIENTO'
    ).trim(),
    sharePointAutoImportEnabled: boolEnv(
      'SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED',
      false
    ),
    sharePointExcelFileName: String(
      process.env.SHAREPOINT_ALFA_EXCEL_FILE_NAME || ''
    ).trim(),
  });
}
