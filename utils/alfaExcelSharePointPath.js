/**
 * Guard de lectura exclusivo:
 *   SEGUROS ALFA/CONTROL Y SEGUIMIENTO/**
 * No escribe ni toca PÓLIZAS / SINIESTROS.
 */

export const ALFA_EXCEL_SHAREPOINT_ROOT = 'SEGUROS ALFA';
export const ALFA_EXCEL_SHAREPOINT_FOLDER = 'CONTROL Y SEGUIMIENTO';
export const ALFA_EXCEL_IMPORT_PREFIX = `${ALFA_EXCEL_SHAREPOINT_ROOT}/${ALFA_EXCEL_SHAREPOINT_FOLDER}`;

function normalizePath(pathValue) {
  return String(pathValue || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\\/g, '/');
}

function deny(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

export function assertAlfaExcelSharePointPath(pathValue) {
  const normalized = normalizePath(pathValue);
  if (!normalized) {
    deny('INVALID_ALFA_EXCEL_PATH', 'Ruta Excel Alfa vacía');
  }
  const segments = normalized.split('/');
  if (segments.includes('..') || segments.some((s) => s === '.')) {
    deny('INVALID_ALFA_EXCEL_PATH', `Path traversal bloqueado: ${normalized}`);
  }
  const prefix = ALFA_EXCEL_IMPORT_PREFIX;
  if (normalized !== prefix && !normalized.startsWith(`${prefix}/`)) {
    deny(
      'INVALID_ALFA_EXCEL_PATH',
      `Excel Alfa solo permite ${prefix}/** (recibido: ${normalized})`
    );
  }
  return normalized;
}

export function isAlfaExcelSharePointPath(pathValue) {
  try {
    assertAlfaExcelSharePointPath(pathValue);
    return true;
  } catch {
    return false;
  }
}

export function isTempOfficeExcelName(name) {
  return String(name || '').startsWith('~$');
}

export function isAcceptedAlfaExcelName(name) {
  const n = String(name || '');
  if (isTempOfficeExcelName(n)) return false;
  return /\.(xlsx|xls)$/i.test(n);
}

/**
 * Copia humana «…_Final.xlsx»: ARNALD NO debe leerla ni escribirla.
 * El consolidado operativo es el mismo nombre sin el sufijo `_Final`.
 */
export function isAlfaExcelFinalProtectedName(name) {
  return /_final\.(xlsx|xls)$/i.test(String(name || '').trim());
}

/** Si env apunta a *_Final.xlsx, lo convierte al archivo operativo. */
export function toAlfaExcelOperationalFileName(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  if (!isAlfaExcelFinalProtectedName(n)) return n;
  return n.replace(/_final(?=\.(xlsx|xls)$)/i, '');
}

export function assertAlfaExcelNotFinalProtected(name) {
  const n = String(name || '').trim();
  if (isAlfaExcelFinalProtectedName(n)) {
    deny(
      'ALFA_EXCEL_FINAL_PROTECTED',
      `Prohibido tocar el consolidado Final («${n}»). Use el archivo operativo sin «_Final».`
    );
  }
  return n;
}
