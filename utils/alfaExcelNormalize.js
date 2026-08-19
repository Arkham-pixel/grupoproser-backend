/**
 * Normalización Excel Alfa (headers + valores).
 */

import { normalizePolicyNumber } from './alfaPolicyNumber.js';

export function normalizeExcelHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/[°º]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeText(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return s || null;
}

/**
 * Identificación como string; sin Number().
 * Elimina separadores (espacios, puntos, guiones, comas).
 * Ej: "88.187.559" → "88187559"
 */
export function normalizeIdentification(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel a veces entrega número: conservar representación sin notación científica
    return String(Math.trunc(value));
  }
  const s = String(value)
    .trim()
    .replace(/[\s.\-,_\u00A0]/g, '');
  return s || null;
}

/** Número de siniestro como string. */
export function normalizeClaimNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  const s = String(value).trim().replace(/\s+/g, '');
  return s || null;
}

export { normalizePolicyNumber };

function fechaBogotaIso(date) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* fallback */
  }
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function excelSerialToIso(serial) {
  const n = Number(serial);
  if (Number.isNaN(n)) return null;
  const utc = Date.UTC(1899, 11, 30) + Math.round(n * 86400000);
  return fechaBogotaIso(new Date(utc));
}

/** @returns {string|null} YYYY-MM-DD */
export function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return fechaBogotaIso(value);
  }
  if (typeof value === 'number') return excelSerialToIso(value);
  const texto = String(value).trim();
  if (!texto) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const mdy = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (mdy) {
    let [, a, b, c] = mdy;
    let year = Number(c);
    if (year < 100) year += 2000;
    let month = Number(a);
    let day = Number(b);
    if (month > 12 && day <= 12) {
      month = Number(b);
      day = Number(a);
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

export function normalizeMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  const texto = String(value).trim();
  if (!texto) return null;
  if (/^(n\/?a|null|undefined|desiste|por confirmar|por confrimar|-)$/i.test(texto)) {
    return null;
  }
  if (!/\d/.test(texto)) return null;
  const limpio = texto.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  if (!limpio || limpio === '-' || limpio === '.' || limpio === '-.') return null;
  const n = Number(limpio);
  return Number.isNaN(n) ? null : n;
}

/**
 * ¿Valor Excel vacío / placeholder que no debe pisar dato bueno?
 */
export function isAlfaExcelPlaceholder(valor) {
  if (valor === undefined || valor === null || valor === '' || valor === 'null' || valor === 'undefined') {
    return true;
  }
  if (valor instanceof Date) return Number.isNaN(valor.getTime());
  if (typeof valor === 'number') return !Number.isFinite(valor);
  const t = String(valor)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!t) return true;
  if (/^POR CONFIRM/.test(t)) return true;
  if (
    /^(N\/?A|NA|NULL|UNDEFINED|DESISTE|-|SIN DATO|SIN INFORMACION|PENDIENTE|PENDIENTE DE INFORMACION)$/i.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/** Alias solicitado en especificación. */
export function isMeaningfulExcelValue(value) {
  return !isAlfaExcelPlaceholder(value);
}

/**
 * Póliza placeholder (ARNALD o Excel).
 * Incluye "POR CONFIRMAR OPERACIONES" y variantes.
 */
export function isPolicyPlaceholder(value) {
  if (value === undefined || value === null || value === '') return true;
  const t = String(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!t) return true;
  const compact = t.replace(/\s+/g, '');
  if (/^POR\s*CONFIRM/.test(t) || compact.startsWith('PORCONFIRMAR')) return true;
  if (
    /^(N\/?A|NA|NULL|UNDEFINED|DESISTE|-|SIN DATO|SIN INFORMACION|PENDIENTE|PENDIENTE DE INFORMACION|SIN POLIZA)$/i.test(
      t
    ) ||
    ['NA', 'N/A', 'PENDIENTE', 'SININFORMACION', 'SINPOLIZA'].includes(compact)
  ) {
    return true;
  }
  return false;
}

export function normalizeCreditNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  const s = String(value).trim().replace(/\s+/g, '');
  return s || null;
}

/**
 * Merge inteligente:
 * - Excel meaningful → puede actualizar (incl. placeholder ARNALD → valor real)
 * - Excel vacío/placeholder → NO pisa dato bueno ARNALD
 * - Excel placeholder → NO pisa póliza/dato real ARNALD
 */
export function mergeAlfaImportValue(incoming, existing, { field } = {}) {
  const incomingMeaningful = isMeaningfulExcelValue(incoming);
  const existingMeaningful = isMeaningfulExcelValue(existing);

  // Póliza / texto: real → placeholder bloqueado
  if (
    (field === 'numeroPoliza' || field === 'siniestro' || field === 'identificacion') &&
    existingMeaningful &&
    !incomingMeaningful
  ) {
    return existing;
  }
  if (field === 'numeroPoliza' && !isPolicyPlaceholder(existing) && isPolicyPlaceholder(incoming)) {
    return existing;
  }

  if (incomingMeaningful) return incoming;
  if (existingMeaningful) return existing;
  if (incoming !== undefined && incoming !== null && incoming !== '') return incoming;
  return existing ?? null;
}

const PERSON_NAME_FIELDS = new Set(['asegurado', 'tomador', 'ajustador']);
const ADDRESS_FIELDS = new Set(['direccionPredio', 'ciudad', 'departamento']);

/** Mayúsculas, tildes y puntuación (#, -, .) no cuentan como cambio real. */
export function foldAlfaComparableText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[#º°]/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokenSet(value) {
  const folded = foldAlfaComparableText(value);
  if (!folded) return new Set();
  return new Set(folded.split(' ').filter(Boolean));
}

function setEquals(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

function setIsSubset(inner, outer) {
  if (inner.size === 0) return false;
  for (const x of inner) {
    if (!outer.has(x)) return false;
  }
  return true;
}

/** Excel recortó el nombre (quitó un apellido) → no es un cambio real. */
export function isIncomingPersonNameWeaker(incoming, existing) {
  const inc = nameTokenSet(incoming);
  const cur = nameTokenSet(existing);
  if (inc.size === 0 || cur.size === 0) return false;
  if (setEquals(inc, cur)) return false;
  return setIsSubset(inc, cur) && inc.size < cur.size;
}

export function valuesEqualForDiff(a, b, field) {
  if (a instanceof Date) a = a.toISOString().slice(0, 10);
  if (b instanceof Date) b = b.toISOString().slice(0, 10);
  const da = typeof a === 'string' ? normalizeDate(a) : null;
  const db = typeof b === 'string' ? normalizeDate(b) : null;
  if (da && db && da === db) return true;

  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = typeof a === 'number' ? a : normalizeMoney(a);
    const nb = typeof b === 'number' ? b : normalizeMoney(b);
    if (na != null && nb != null) return Number(na) === Number(nb);
    return Number(a) === Number(b);
  }

  const key = String(field || '');
  if (key === 'correo') {
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }
  if (PERSON_NAME_FIELDS.has(key)) {
    return setEquals(nameTokenSet(a), nameTokenSet(b));
  }
  if (ADDRESS_FIELDS.has(key)) {
    return foldAlfaComparableText(a) === foldAlfaComparableText(b);
  }

  return (
    foldAlfaComparableText(a) === foldAlfaComparableText(b) ||
    String(a).trim().replace(/\s+/g, '') === String(b).trim().replace(/\s+/g, '') ||
    String(a).trim() === String(b).trim()
  );
}

/**
 * Mapeo al pulsar Actualizar (Excel ↔ ARNALD). Nunca borra un lado lleno con un vacío.
 *
 * - Excel vacío + ARNALD lleno → conservar ARNALD
 * - Excel lleno + ARNALD vacío → tomar Excel
 * - Ambos llenos, campo amarillo (ARNALD) → conservar ARNALD
 * - Ambos llenos, campo verde (Alfa) → tomar Excel
 */
export function decideAlfaExcelMerge(incoming, existing, { field, arnaldOwned = false } = {}) {
  const incomingOk = isMeaningfulExcelValue(incoming);
  const existingOk = isMeaningfulExcelValue(existing);

  if (!incomingOk && existingOk) {
    return { value: existing, action: 'KEEP_ARNALD_EXCEL_EMPTY' };
  }
  if (incomingOk && !existingOk) {
    return { value: incoming, action: 'FILL_FROM_EXCEL' };
  }
  if (!incomingOk && !existingOk) {
    return { value: existing ?? incoming ?? null, action: 'BOTH_EMPTY' };
  }

  if (
    field === 'numeroPoliza' &&
    !isPolicyPlaceholder(existing) &&
    isPolicyPlaceholder(incoming)
  ) {
    return { value: existing, action: 'INCOMING_PLACEHOLDER_IGNORED' };
  }

  if (arnaldOwned) {
    if (valuesEqualForDiff(incoming, existing, field)) {
      return { value: existing, action: 'UNCHANGED' };
    }
    return { value: existing, action: 'KEEP_ARNALD_OWNED' };
  }

  if (valuesEqualForDiff(incoming, existing, field)) {
    return { value: existing, action: 'UNCHANGED' };
  }
  if (PERSON_NAME_FIELDS.has(String(field || '')) && isIncomingPersonNameWeaker(incoming, existing)) {
    return { value: existing, action: 'KEEP_ARNALD_EXCEL_WEAKER_NAME' };
  }
  return { value: incoming, action: 'UPDATE_FROM_EXCEL' };
}

/** ARNALD vacío no debe borrar una celda Excel llena (columnas amarillas). */
export function isAlfaOutboundEmptyValue(value) {
  if (value === undefined || value === null || value === '') return true;
  if (value instanceof Date) return Number.isNaN(value.getTime());
  if (typeof value === 'number') return !Number.isFinite(value);
  return String(value).trim() === '';
}

/** Póliza: si Excel entrega number, intentar conservar ceros no es posible;
 * preferir string. Si viene number, String(trunc). */
export function normalizePolicyNumberFromExcel(value) {
  if (value == null || value === '') return null;
  // Si viene como string con ceros, preserve
  if (typeof value === 'string') {
    const n = normalizePolicyNumber(value);
    return n || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Pérdida de ceros inevitable si Excel ya casteó a number
    return normalizePolicyNumber(String(Math.trunc(value)));
  }
  return normalizePolicyNumber(value) || null;
}
