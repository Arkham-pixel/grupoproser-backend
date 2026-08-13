/**
 * Normalización y matching de identificación Alfa (carpeta SharePoint → caso).
 * Reutiliza normalizeIdentification del Excel; añade regex de variantes.
 */

import { normalizeIdentification } from './alfaExcelNormalize.js';

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

/** Placeholder típico de Excel Alfa (no es número de póliza real). */
export function isPlaceholderPolicyNumber(value) {
  const s = String(value ?? '')
    .trim()
    .toUpperCase();
  if (!s) return true;
  if (s === 'N/A' || s === 'NA' || s === 'NULL' || s === '-') return true;
  if (s.includes('POR CONFIRMAR')) return true;
  if (s.includes('PENDIENTE')) return true;
  return false;
}

export function isRealPolicyNumber(value) {
  const s = String(value ?? '').trim();
  if (!s) return false;
  return !isPlaceholderPolicyNumber(s);
}
