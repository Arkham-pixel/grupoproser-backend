/**
 * Guard central de rutas SharePoint (réplica).
 * Conserva assertTestPath para scripts/pruebas aisladas.
 *
 * Alfa NUEVOS writes: SEGUROS ALFA/SINIESTROS/{cedula}/** (carpeta aseguradora)
 * y SEGUROS ALFA/PÓLIZAS/** (compat inbound). Excel no usa este guard.
 */

import { getSharePointSyncConfig } from '../config/sharepointSync.js';
import { getSharePointTestRoot, assertTestPath } from './sharepointTestPath.js';
import {
  getAlfaSharePointAllowedPrefix,
  isAlfaSharePointPath,
} from './alfaSharePointPath.js';
import {
  ALFA_DOC_IMPORT_PREFIX,
  ALFA_DOC_SINIESTROS_PREFIX,
  isAlfaSiniestrosCedulaWritePath,
} from './alfaDocumentPath.js';

const ALWAYS_BLOCKED_ROOTS = new Set([
  'CONTROL Y SEGUIMIENTO',
  'Documentos',
  'Documents',
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

/**
 * @param {{ path: string, sourceModule?: string, mode?: string }} opts
 * @returns {string} ruta normalizada
 */
export function assertAllowedSharePointPath({ path, sourceModule, mode } = {}) {
  const cfg = getSharePointSyncConfig();
  const effectiveMode = String(mode || cfg.mode || 'test').toLowerCase();
  const normalized = normalizePath(path);
  const testRoot = getSharePointTestRoot();
  const module = String(sourceModule || '').toLowerCase();

  if (!normalized) {
    deny('INVALID_SHAREPOINT_PATH', 'Ruta SharePoint vacía');
  }

  const first = normalized.split('/')[0];
  const firstUpper = first.toUpperCase();

  if (ALWAYS_BLOCKED_ROOTS.has(first) || ALWAYS_BLOCKED_ROOTS.has(firstUpper)) {
    deny('INVALID_SHAREPOINT_PATH', `Ruta bloqueada: ${normalized}`);
  }

  const underTestRoot =
    normalized === testRoot || normalized.startsWith(`${testRoot}/`);

  // Alfa: mode=test → TEST_ARNALD; pilot → SINIESTROS/{cedula} o PÓLIZAS (compat)
  if (module === 'alfa') {
    if (effectiveMode === 'test' || (cfg.forceTestRoot && effectiveMode !== 'pilot')) {
      if (!underTestRoot) {
        deny(
          'INVALID_SHAREPOINT_PATH',
          `Alfa mode=test solo permite ${testRoot}/**`
        );
      }
      return assertTestPath(normalized);
    }

    if (!cfg.alfaEnabled) {
      deny(
        'INVALID_SHAREPOINT_PATH',
        'Rutas Alfa de producción requieren SHAREPOINT_SYNC_ALFA_ENABLED=true'
      );
    }

    // Alfa writes: PÓLIZAS (histórico) o SINIESTROS/{cedula} (carpeta de la aseguradora).
    // No crear PENDIENTES_NUMERO_SINIESTRO ni carpetas que no sean cédula.
    if (first === 'SINIESTROS' || firstUpper === 'SINIESTROS') {
      deny(
        'INVALID_SHAREPOINT_PATH',
        'Alfa no escribe en la raíz global SINIESTROS/; use SEGUROS ALFA/SINIESTROS/{cedula}/...'
      );
    }
    if (
      normalized === 'SEGUROS ALFA/SINIESTROS' ||
      normalized.startsWith('SEGUROS ALFA/SINIESTROS/PENDIENTES')
    ) {
      deny(
        'INVALID_SHAREPOINT_PATH',
        'Alfa no escribe en SEGUROS ALFA/SINIESTROS raíz ni PENDIENTES_*; solo {cedula}/subcarpeta'
      );
    }
    const siniestrosCedula = isAlfaSiniestrosCedulaWritePath(normalized);
    if (
      !isAlfaSharePointPath(normalized) &&
      !siniestrosCedula
    ) {
      deny(
        'INVALID_SHAREPOINT_PATH',
        `Alfa solo permite ${getAlfaSharePointAllowedPrefix()}/** o ${ALFA_DOC_SINIESTROS_PREFIX}/{cedula}/** (recibido: ${normalized})`
      );
    }

    // Exigir tilde en PÓLIZAS
    if (
      normalized.startsWith('SEGUROS ALFA/POLIZAS/') ||
      normalized === 'SEGUROS ALFA/POLIZAS'
    ) {
      deny(
        'INVALID_SHAREPOINT_PATH',
        `Usar ${ALFA_DOC_IMPORT_PREFIX} (con tilde), no POLIZAS sin tilde`
      );
    }

    return normalized;
  }

  if (effectiveMode === 'test') {
    if (!underTestRoot) {
      deny(
        'INVALID_SHAREPOINT_PATH',
        `mode=test solo permite ${testRoot}/** (recibido: ${normalized})`
      );
    }
    return assertTestPath(normalized);
  }

  if (effectiveMode === 'pilot') {
    if (underTestRoot) {
      return assertTestPath(normalized);
    }

    deny(
      'INVALID_SHAREPOINT_PATH',
      `mode=pilot: módulo "${module || 'unknown'}" no autorizado fuera de ${testRoot}`
    );
  }

  if (!underTestRoot) {
    deny(
      'INVALID_SHAREPOINT_PATH',
      `mode=${effectiveMode}: solo ${testRoot}/** hasta habilitar producción`
    );
  }
  return assertTestPath(normalized);
}

export { assertTestPath, getSharePointTestRoot };
