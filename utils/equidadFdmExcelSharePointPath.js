/**
 * Guard: solo SEGUROS EQUIDAD/**
 */

export const EQUIDAD_FDM_EXCEL_SHAREPOINT_ROOT = 'SEGUROS EQUIDAD';

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

export function assertEquidadFdmExcelSharePointPath(pathValue) {
  const normalized = normalizePath(pathValue);
  if (!normalized) {
    deny('INVALID_EQUIDAD_FDM_EXCEL_PATH', 'Ruta Excel Equidad FDM vacía');
  }
  const segments = normalized.split('/');
  if (segments.includes('..') || segments.some((s) => s === '.')) {
    deny('INVALID_EQUIDAD_FDM_EXCEL_PATH', `Path traversal bloqueado: ${normalized}`);
  }
  const root = EQUIDAD_FDM_EXCEL_SHAREPOINT_ROOT;
  if (normalized !== root && !normalized.startsWith(`${root}/`)) {
    deny(
      'INVALID_EQUIDAD_FDM_EXCEL_PATH',
      `Excel Equidad FDM solo permite ${root}/** (recibido: ${normalized})`
    );
  }
  return normalized;
}

export function isTempOfficeExcelName(name) {
  const n = String(name || '');
  return n.startsWith('~$') || n.startsWith('.~');
}

export function isAcceptedEquidadFdmExcelName(name) {
  if (isTempOfficeExcelName(name)) return false;
  return /\.xlsx$/i.test(String(name || ''));
}
