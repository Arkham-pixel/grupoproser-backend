/**
 * Normalización de número de póliza Alfa (llave de asociación SharePoint → ARNALD).
 *
 * Reglas (piloto):
 * - Siempre String (nunca Number) → conserva ceros a la izquierda.
 * - trim extremos.
 * - Elimina TODOS los espacios en blanco (espacios, tabs, saltos) → "001 234" → "001234".
 * - No aplica fuzzy (Levenshtein, prefijos, etc.).
 * - Comparación case-sensitive tras normalizar.
 *
 * Matching flexible inicial: regex que permite whitespace entre caracteres del valor
 * normalizado, y luego se re-filtra con normalizePolicyNumber === esperado.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePolicyNumber(value) {
  if (value == null) return '';
  return String(value).trim().replace(/\s+/g, '');
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex para variantes con espacios intercalados del mismo número normalizado.
 * Ej: "5400123" coincide con "5400 123" o " 5400123 ".
 * @param {string} normalized
 * @returns {RegExp|null}
 */
export function policyNumberMatchRegex(normalized) {
  const n = normalizePolicyNumber(normalized);
  if (!n) return null;
  const parts = [...n].map((ch) => escapeRegex(ch));
  return new RegExp(`^\\s*${parts.join('\\s*')}\\s*$`);
}

/**
 * ¿Dos valores de póliza representan la misma llave?
 * @param {unknown} a
 * @param {unknown} b
 */
export function policyNumbersEqual(a, b) {
  const na = normalizePolicyNumber(a);
  const nb = normalizePolicyNumber(b);
  return Boolean(na) && na === nb;
}
