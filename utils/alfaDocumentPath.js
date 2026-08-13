/**
 * Path documental definitivo Seguros Alfa (ARNALD ↔ SharePoint).
 *
 * Root:
 *   SEGUROS ALFA/PÓLIZAS/{IDENTIFICACION} - {NUMERO_POLIZA}/{SUBCARPETA}
 *
 * El número de siniestro NO interviene.
 * Placeholder de póliza → no construir carpeta definitiva.
 */

import { normalizeIdentification } from './alfaIdentification.js';
import { normalizePolicyNumber } from './alfaPolicyNumber.js';
import { isPolicyPlaceholder } from './alfaExcelNormalize.js';
import { sanitizeSharePointSegment } from './sharepointClaimPath.js';

export const ALFA_DOC_SHAREPOINT_ROOT = 'SEGUROS ALFA';
export const ALFA_DOC_SHAREPOINT_POLIZAS = 'PÓLIZAS';
export const ALFA_DOC_IMPORT_PREFIX = `${ALFA_DOC_SHAREPOINT_ROOT}/${ALFA_DOC_SHAREPOINT_POLIZAS}`;

/** Subcarpetas definitivas bajo el expediente. */
export const ALFA_DOCUMENT_SUBFOLDERS = Object.freeze({
  poliza: 'POLIZA',
  general: 'GENERAL',
  soporte: 'GENERAL',
  inspeccion: 'INSPECCION',
  fotografia: 'FOTOS',
  informe: 'INFORMES',
  liquidacion: 'LIQUIDACION',
  otro: 'OTRO',
});

const SUBFOLDER_TO_TYPE = Object.freeze({
  POLIZA: 'poliza',
  GENERAL: 'general',
  INSPECCION: 'inspeccion',
  FOTOS: 'fotografia',
  INFORMES: 'informe',
  LIQUIDACION: 'liquidacion',
  OTRO: 'otro',
});

export function isAlfaPolicyNumberPlaceholder(value) {
  return isPolicyPlaceholder(value) || isPlaceholderLoose(value);
}

function isPlaceholderLoose(value) {
  const s = String(value ?? '')
    .trim()
    .toUpperCase();
  if (!s) return true;
  if (s === 'POR CONFIRMAR') return true;
  if (s.includes('SIN INFORMACION') || s.includes('SIN INFORMACIÓN')) return true;
  return false;
}

export function isRealAlfaPolicyNumber(value) {
  const n = normalizePolicyNumber(value);
  if (!n) return false;
  return !isAlfaPolicyNumberPlaceholder(n);
}

/**
 * Segmento de expediente: "{identificacion} - {numeroPoliza}"
 * @returns {string|null}
 */
export function buildAlfaExpedienteFolderName(identificacion, numeroPoliza) {
  const id = normalizeIdentification(identificacion);
  const pol = normalizePolicyNumber(numeroPoliza);
  if (!id || !isRealAlfaPolicyNumber(pol)) return null;
  const idSeg = sanitizeSharePointSegment(id, { fallback: '' });
  const polSeg = sanitizeSharePointSegment(pol, { fallback: '' });
  if (!idSeg || !polSeg) return null;
  return `${idSeg} - ${polSeg}`;
}

/**
 * @param {string} documentType ClaimDocument / inbound type key
 * @returns {string} POLIZA|GENERAL|...
 */
export function getAlfaDocumentSubfolder(documentType) {
  const key = String(documentType || '')
    .trim()
    .toLowerCase();
  return ALFA_DOCUMENT_SUBFOLDERS[key] || ALFA_DOCUMENT_SUBFOLDERS.otro;
}

/**
 * Builder central de carpeta destino (sin nombre de archivo).
 *
 * @param {{ identificacion: string, numeroPoliza: string, documentType: string }} opts
 * @returns {{
 *   ok: boolean,
 *   path?: string,
 *   expedienteFolder?: string,
 *   subfolder?: string,
 *   code?: string,
 *   reason?: string,
 * }}
 */
export function buildAlfaDocumentPath({
  identificacion,
  numeroPoliza,
  documentType,
} = {}) {
  const id = normalizeIdentification(identificacion);
  if (!id) {
    return {
      ok: false,
      code: 'MISSING_IDENTIFICATION',
      reason: 'MISSING_IDENTIFICATION',
    };
  }

  if (!isRealAlfaPolicyNumber(numeroPoliza)) {
    return {
      ok: false,
      code: 'PENDING_DESTINATION',
      reason: 'MISSING_REAL_POLICY_NUMBER',
    };
  }

  const expedienteFolder = buildAlfaExpedienteFolderName(id, numeroPoliza);
  if (!expedienteFolder) {
    return {
      ok: false,
      code: 'PENDING_DESTINATION',
      reason: 'MISSING_REAL_POLICY_NUMBER',
    };
  }

  const subfolder = getAlfaDocumentSubfolder(documentType);
  const path = `${ALFA_DOC_IMPORT_PREFIX}/${expedienteFolder}/${subfolder}`;
  return {
    ok: true,
    path,
    expedienteFolder,
    subfolder,
    identificacion: id,
    numeroPoliza: normalizePolicyNumber(numeroPoliza),
  };
}

/**
 * Parsea nombre de carpeta bajo PÓLIZAS.
 * - "88187559" → provisional (solo identificación)
 * - "88187559 - INC-008" → definitiva
 *
 * @param {string} folderName
 */
export function parseAlfaPolizasFolderName(folderName) {
  const raw = String(folderName || '').trim();
  if (!raw || raw.includes('/') || raw.includes('\\')) {
    return { ok: false, code: 'INVALID_FOLDER_NAME' };
  }

  const sep = raw.includes(' - ') ? ' - ' : raw.includes(' – ') ? ' – ' : null;
  if (sep) {
    const idx = raw.indexOf(sep);
    const left = raw.slice(0, idx).trim();
    const right = raw.slice(idx + sep.length).trim();
    const identificacion = normalizeIdentification(left);
    const numeroPoliza = normalizePolicyNumber(right);
    if (!identificacion) {
      return { ok: false, code: 'INVALID_IDENTIFICATION' };
    }
    if (!numeroPoliza || isAlfaPolicyNumberPlaceholder(numeroPoliza)) {
      return {
        ok: true,
        form: 'provisional',
        sourceIdentifier: identificacion,
        sourceIdentifierType: 'identificacion',
        identificacion,
        numeroPoliza: null,
      };
    }
    return {
      ok: true,
      form: 'definitiva',
      sourceIdentifier: identificacion,
      sourceIdentifierType: 'identificacion',
      identificacion,
      numeroPoliza,
    };
  }

  const identificacion = normalizeIdentification(raw);
  if (!identificacion) {
    return { ok: false, code: 'INVALID_IDENTIFICATION' };
  }
  // Evitar interpretar "INC-008" solo como identificación
  if (!/^\d{5,15}$/.test(identificacion) && /[A-Za-z]/.test(raw)) {
    return { ok: false, code: 'NOT_IDENTIFICATION_FOLDER' };
  }
  return {
    ok: true,
    form: 'provisional',
    sourceIdentifier: identificacion,
    sourceIdentifierType: 'identificacion',
    identificacion,
    numeroPoliza: null,
  };
}

/**
 * @param {string} subfolderName
 * @returns {string|null} documentType
 */
export function mapAlfaSubfolderToDocumentType(subfolderName) {
  const key = String(subfolderName || '')
    .trim()
    .toUpperCase();
  return SUBFOLDER_TO_TYPE[key] || null;
}

export function isAlfaDefinitiveDocumentPath(pathValue) {
  const n = String(pathValue || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\\/g, '/');
  return n === ALFA_DOC_IMPORT_PREFIX || n.startsWith(`${ALFA_DOC_IMPORT_PREFIX}/`);
}

/**
 * ¿La ruta es del esquema documental viejo (no definitiva PÓLIZAS/{id} - {poliza})?
 */
export function classifyAlfaSharePointPath(pathValue) {
  const n = String(pathValue || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\\/g, '/');
  if (!n) return { kind: 'empty' };

  if (n.startsWith('SINIESTROS/SEGUROS ALFA/') || n === 'SINIESTROS/SEGUROS ALFA') {
    return { kind: 'OLD_ALFA_SHAREPOINT_PATH', subtype: 'legacy_root_siniestros' };
  }
  if (
    n.startsWith('SEGUROS ALFA/SINIESTROS/PENDIENTES_NUMERO_SINIESTRO/') ||
    n === 'SEGUROS ALFA/SINIESTROS/PENDIENTES_NUMERO_SINIESTRO'
  ) {
    return { kind: 'OLD_ALFA_SHAREPOINT_PATH', subtype: 'pendientes_consecutivo' };
  }
  if (n.startsWith('SEGUROS ALFA/SINIESTROS/') || n === 'SEGUROS ALFA/SINIESTROS') {
    return { kind: 'OLD_ALFA_SHAREPOINT_PATH', subtype: 'siniestros_module' };
  }
  if (n.startsWith(`${ALFA_DOC_IMPORT_PREFIX}/`) || n === ALFA_DOC_IMPORT_PREFIX) {
    const rest = n.slice(ALFA_DOC_IMPORT_PREFIX.length).replace(/^\//, '');
    const firstSeg = rest.split('/')[0] || '';
    const parsed = parseAlfaPolizasFolderName(firstSeg);
    if (parsed.ok && parsed.form === 'definitiva') {
      return { kind: 'NEW_ALFA_DOCUMENT_PATH', form: 'definitiva', parsed };
    }
    if (parsed.ok && parsed.form === 'provisional') {
      return { kind: 'LEGACY_COMPAT_POLIZAS_ID', form: 'provisional', parsed };
    }
    return { kind: 'OLD_ALFA_SHAREPOINT_PATH', subtype: 'polizas_unparsed' };
  }
  if (n.startsWith('SEGUROS ALFA/')) {
    return { kind: 'OTHER_ALFA', path: n };
  }
  return { kind: 'NON_ALFA', path: n };
}

/**
 * Propone ruta nueva (solo diagnóstico).
 */
export function proposeAlfaDocumentPath({
  identificacion,
  numeroPoliza,
  documentType,
} = {}) {
  const built = buildAlfaDocumentPath({
    identificacion,
    numeroPoliza,
    documentType,
  });
  if (built.ok) return built.path;
  if (built.reason === 'MISSING_REAL_POLICY_NUMBER') {
    return '(PENDING_DESTINATION — falta número de póliza real)';
  }
  return `(no propuesta: ${built.reason || built.code})`;
}
