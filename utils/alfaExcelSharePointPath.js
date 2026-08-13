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
