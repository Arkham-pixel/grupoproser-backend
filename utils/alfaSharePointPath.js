/**
 * Rutas SharePoint exclusivas del módulo Seguros Alfa (LEGACY outbound).
 *
 * NUEVO esquema (usar buildAlfaDocumentPath):
 *   SEGUROS ALFA/PÓLIZAS/{IDENTIFICACION} - {NUMERO_POLIZA}/{SUBCARPETA}
 *
 * Este módulo se conserva para clasificar/leer históricos SINIESTROS.
 * Los NUEVOS writes van por utils/alfaDocumentPath.js.
 */

import { getSharePointFolderForDocumentType } from '../config/claimDocumentTypes.js';
import { sanitizeSharePointSegment } from './sharepointClaimPath.js';
import {
  ALFA_DOC_IMPORT_PREFIX,
  isAlfaDefinitiveDocumentPath,
} from './alfaDocumentPath.js';

export const ALFA_SHAREPOINT_ROOT = 'SEGUROS ALFA';
export const ALFA_SHAREPOINT_SINIESTROS = 'SINIESTROS';
export const ALFA_SHAREPOINT_PENDIENTES = 'PENDIENTES_NUMERO_SINIESTRO';
export const ALFA_SHAREPOINT_POLIZAS = 'PÓLIZAS';

/**
 * @deprecated Preferir buildAlfaDocumentPath. Solo para compat lectura históricos.
 */
export function buildAlfaSharePointPath({
  claimNumber,
  documentType,
  claimNumberSource,
} = {}) {
  const claimSeg = sanitizeSharePointSegment(claimNumber, {
    fallback: 'SIN_EXPEDIENTE',
  });
  const tipoFolder = getSharePointFolderForDocumentType(documentType);

  const base = [ALFA_SHAREPOINT_ROOT, ALFA_SHAREPOINT_SINIESTROS];

  if (String(claimNumberSource || '').toLowerCase() === 'consecutivo') {
    return [...base, ALFA_SHAREPOINT_PENDIENTES, claimSeg, tipoFolder].join('/');
  }

  return [...base, claimSeg, tipoFolder].join('/');
}

/** Prefijo permitido para NUEVOS writes Alfa. */
export function getAlfaSharePointAllowedPrefix() {
  return ALFA_DOC_IMPORT_PREFIX;
}

/** Prefijos históricos (solo lectura / inventario; no nuevos writes). */
export function getAlfaSharePointLegacyPrefixes() {
  return [
    `${ALFA_SHAREPOINT_ROOT}/${ALFA_SHAREPOINT_SINIESTROS}`,
    'SINIESTROS/SEGUROS ALFA',
  ];
}

export function isAlfaSharePointPath(pathValue) {
  return isAlfaDefinitiveDocumentPath(pathValue);
}

export function isAlfaLegacySharePointPath(pathValue) {
  const normalized = String(pathValue || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\\/g, '/');
  return getAlfaSharePointLegacyPrefixes().some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}
