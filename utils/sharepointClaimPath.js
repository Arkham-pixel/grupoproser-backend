/**
 * Construcción segura de rutas SharePoint para réplica de siniestros.
 * No acepta rutas arbitrarias del cliente.
 */

import { getSharePointFolderForDocumentType } from '../config/claimDocumentTypes.js';

const FORBIDDEN = /[<>:"|?*\u0000-\u001f]/g;
const MULTI_SPACE = /\s+/g;
const MULTI_UNDERSCORE = /_+/g;

/**
 * Sanitiza un segmento de carpeta SharePoint.
 * Conserva letras, números, espacios, guiones y guion bajo.
 */
export function sanitizeSharePointSegment(value, { fallback = 'SIN_NOMBRE', maxLen = 120 } = {}) {
  let s = String(value ?? '')
    .normalize('NFKC')
    .replace(FORBIDDEN, '')
    .replace(/[\\/]+/g, '-')
    .replace(MULTI_SPACE, ' ')
    .trim();

  s = s.replace(/^\.+/, '').replace(/\.+$/, '');
  if (!s) s = fallback;
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}

/**
 * @returns {string} Ruta relativa a la biblioteca Documentos, sin slash inicial.
 * Ejemplo prod: SINIESTROS/SEGUROS ALFA/ALFA-2026-00125/02_POLIZA
 * Ejemplo test: TEST_ARNALD/WORKER_TEST/TEST/TEST-WORKER-001/02_POLIZA
 */
export function buildSharePointClaimPath({
  insurer,
  claimNumber,
  documentType,
  rootPrefix = null,
} = {}) {
  const insurerSeg = sanitizeSharePointSegment(insurer, { fallback: 'SIN_ASEGURADORA' });
  const claimSeg = sanitizeSharePointSegment(claimNumber, { fallback: 'SIN_SINIESTRO' });
  const folder = getSharePointFolderForDocumentType(documentType);

  if (rootPrefix) {
    const parts = String(rootPrefix)
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .map((p) => sanitizeSharePointSegment(p, { fallback: 'TEST' }))
      .filter(Boolean);
    return [...parts, insurerSeg, claimSeg, folder].join('/');
  }

  return ['SINIESTROS', insurerSeg, claimSeg, folder].join('/');
}

/**
 * Sanitiza nombre de archivo para almacenamiento / réplica.
 */
export function sanitizeStoredFileName(originalName, { maxLen = 180 } = {}) {
  const raw = String(originalName || 'documento');
  const lastDot = raw.lastIndexOf('.');
  const ext = lastDot > 0 ? raw.slice(lastDot).replace(/[^.a-zA-Z0-9]/g, '') : '';
  const base = (lastDot > 0 ? raw.slice(0, lastDot) : raw)
    .normalize('NFKC')
    .replace(FORBIDDEN, '')
    .replace(/[\\/]+/g, '_')
    .replace(MULTI_SPACE, '_')
    .replace(MULTI_UNDERSCORE, '_')
    .replace(/^_+|_+$/g, '');

  const safeBase = base || 'documento';
  const name = `${safeBase}${ext}`;
  return name.length > maxLen ? name.slice(0, maxLen) : name;
}
