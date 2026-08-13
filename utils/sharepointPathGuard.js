/**
 * Guard central de rutas SharePoint (réplica).
 * Conserva assertTestPath para scripts/pruebas aisladas.
 *
 * Alfa NUEVOS writes: solo SEGUROS ALFA/PÓLIZAS/**
 * Excel: guard independiente (CONTROL Y SEGUIMIENTO) — no usa este guard.
 */

import { getSharePointSyncConfig } from '../config/sharepointSync.js';
import { getSharePointTestRoot, assertTestPath } from './sharepointTestPath.js';
import {
  getAlfaSharePointAllowedPrefix,
  isAlfaSharePointPath,
} from './alfaSharePointPath.js';
import { ALFA_DOC_IMPORT_PREFIX } from './alfaDocumentPath.js';

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

  // Alfa: NUEVOS writes solo SEGUROS ALFA/PÓLIZAS/**
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

    // Bloquear raíz global SINIESTROS y el esquema viejo SEGUROS ALFA/SINIESTROS
    if (first === 'SINIESTROS' || firstUpper === 'SINIESTROS') {
      deny(
        'INVALID_SHAREPOINT_PATH',
        'Alfa ya no escribe en la raíz global SINIESTROS/; use SEGUROS ALFA/PÓLIZAS/...'
      );
    }
    if (
      normalized.startsWith('SEGUROS ALFA/SINIESTROS/') ||
      normalized === 'SEGUROS ALFA/SINIESTROS'
    ) {
      deny(
        'INVALID_SHAREPOINT_PATH',
        'Alfa ya no crea nuevos documentos en SEGUROS ALFA/SINIESTROS/**; use SEGUROS ALFA/PÓLIZAS/{ID} - {POLIZA}/...'
      );
    }

    if (!isAlfaSharePointPath(normalized)) {
      deny(
        'INVALID_SHAREPOINT_PATH',
        `Alfa solo permite ${getAlfaSharePointAllowedPrefix()}/** (recibido: ${normalized})`
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
