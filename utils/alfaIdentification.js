/**
 * Normalización y matching de identificación Alfa (carpeta SharePoint → caso).
 * Reutiliza normalizeIdentification del Excel; añade regex de variantes.
 */

import { normalizeIdentification, isPolicyPlaceholder } from './alfaExcelNormalize.js';

export { normalizeIdentification };

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex que tolera espacios/puntos/guiones intercalados sobre el valor normalizado.
 * Compatible con MongoDB PCRE2 (sin \uXXXX).
 * @param {string} normalized
 * @returns {RegExp|null}
 */
export function identificationMatchRegex(normalized) {
  const n = normalizeIdentification(normalized);
  if (!n) return null;
  const parts = [...n].map((ch) => escapeRegex(ch));
  // Separadores: espacio, punto, guion, guion bajo, coma (sin escapes unicode)
  const sep = '[\\s.\\-,_]*';
  return new RegExp(`^${sep}${parts.join(sep)}${sep}$`);
}

export function identificationsEqual(a, b) {
  const na = normalizeIdentification(a);
  const nb = normalizeIdentification(b);
  return Boolean(na) && na === nb;
}

/** La carpeta SharePoint {cedula} solo puede mostrarse en casos de esa misma cédula. */
export function inboundFolderMatchesCase(sourceIdentifier, caso) {
  return identificationsEqual(sourceIdentifier, caso?.identificacion);
}

/**
 * Placeholder típico de Excel Alfa (no es número de póliza real).
 * Incluye "POR CONFIRMAR OPERACIONES" y la forma compacta sin espacios
 * (PORCONFIRMAROPERACIONES) que queda tras normalizePolicyNumber.
 */
export function isPlaceholderPolicyNumber(value) {
  return isPolicyPlaceholder(value);
}

export function isRealPolicyNumber(value) {
  const s = String(value ?? '').trim();
  if (!s) return false;
  return !isPlaceholderPolicyNumber(s);
}
