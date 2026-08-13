/**
 * Guard de lectura inbound pólizas/documentos Alfa bajo:
 *   SEGUROS ALFA/PÓLIZAS/**
 *
 * Compat:
 *   PÓLIZAS/{IDENTIFICACION}/
 *   PÓLIZAS/{IDENTIFICACION} - {NUMERO_POLIZA}/
 *
 * Lectura legacy opcional (no write):
 *   SEGUROS ALFA/SINIESTROS/{IDENTIFICACION}/
 */

import { ALFA_DOC_IMPORT_PREFIX } from './alfaDocumentPath.js';

export const ALFA_POLICY_SHAREPOINT_ROOT = 'SEGUROS ALFA';
export const ALFA_POLICY_SHAREPOINT_POLIZAS = 'PÓLIZAS';
export const ALFA_POLICY_IMPORT_PREFIX = ALFA_DOC_IMPORT_PREFIX;
export const ALFA_SINIESTROS_INBOUND_PREFIX = 'SEGUROS ALFA/SINIESTROS';

export const ALFA_POLICY_INBOUND_ROOTS = Object.freeze([
  ALFA_POLICY_IMPORT_PREFIX,
  ALFA_SINIESTROS_INBOUND_PREFIX,
]);

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

export function assertAlfaPolicyImportPath(pathValue) {
  const normalized = normalizePath(pathValue);

  if (!normalized) {
    deny('INVALID_POLICY_IMPORT_PATH', 'Ruta de importación de póliza vacía');
  }

  const segments = normalized.split('/');
  if (segments.includes('..') || segments.some((s) => s === '.')) {
    deny('INVALID_POLICY_IMPORT_PATH', `Path traversal bloqueado: ${normalized}`);
  }

  const allowed = ALFA_POLICY_INBOUND_ROOTS.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
  if (!allowed) {
    deny(
      'INVALID_POLICY_IMPORT_PATH',
      `Importación Alfa solo permite ${ALFA_POLICY_INBOUND_ROOTS.join('/** o ')}/** (recibido: ${normalized}). No usar POLIZAS sin tilde.`
    );
  }

  return normalized;
}

export function assertAlfaPolicyImportRoot(pathValue) {
  const normalized = assertAlfaPolicyImportPath(pathValue);
  const isRoot = ALFA_POLICY_INBOUND_ROOTS.includes(normalized);
  if (!isRoot) {
    deny(
      'INVALID_POLICY_IMPORT_ROOT',
      `La raíz debe ser una de: ${ALFA_POLICY_INBOUND_ROOTS.join(', ')} (recibido: ${normalized})`
    );
  }
  return normalized;
}

export function isAlfaPolicyImportPath(pathValue) {
  try {
    assertAlfaPolicyImportPath(pathValue);
    return true;
  } catch {
    return false;
  }
}

export function buildAlfaPolicyFolderPath(identification) {
  const seg = String(identification || '').trim();
  if (!seg || seg.includes('/') || seg.includes('\\') || seg.includes('..')) {
    const err = new Error('identificacion inválida para ruta SharePoint');
    err.code = 'INVALID_SOURCE_IDENTIFIER';
    throw err;
  }
  return assertAlfaPolicyImportPath(`${ALFA_POLICY_IMPORT_PREFIX}/${seg}`);
}
