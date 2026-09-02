/**
 * Formatos de celda Excel Alfa alineados al consolidado operativo.
 * Fechas: mm-dd-yy | Moneda COP: [$$-240A] #,##0
 */

import {
  ALFA_EXCEL_DATE_FIELDS,
  ALFA_EXCEL_MONEY_FIELDS,
} from '../config/alfaExcelColumnMap.js';

/** Formato fecha del consolidado PROSER (SharePoint). */
export const ALFA_EXCEL_DATE_NUM_FMT = 'mm-dd-yy';

/** Formato moneda COP del consolidado PROSER. */
export const ALFA_EXCEL_MONEY_NUM_FMT = '[$$-240A] #,##0';

/**
 * @param {string} field
 * @returns {string|null}
 */
export function getAlfaExcelDefaultNumFmt(field) {
  if (ALFA_EXCEL_DATE_FIELDS.includes(field)) return ALFA_EXCEL_DATE_NUM_FMT;
  if (ALFA_EXCEL_MONEY_FIELDS.includes(field)) return ALFA_EXCEL_MONEY_NUM_FMT;
  return null;
}

/**
 * Prefiere el formato ya usado en la columna del Excel; si no hay, el default del campo.
 * @param {import('exceljs').Worksheet} ws
 * @param {number} colNum
 * @param {string} field
 * @param {number[]} [sampleRows]
 */
export function resolveAlfaExcelColumnNumFmt(
  ws,
  colNum,
  field,
  sampleRows = [2, 3, 4, 5, 10, 20, 50]
) {
  if (!ws || !colNum) return getAlfaExcelDefaultNumFmt(field);
  for (const r of sampleRows) {
    try {
      const fmt = ws.getRow(r).getCell(colNum).numFmt;
      if (fmt && String(fmt).trim()) return String(fmt);
    } catch {
      /* ignore */
    }
  }
  return getAlfaExcelDefaultNumFmt(field);
}

/**
 * Asigna value + numberFormat ExcelJS según tipo de campo / columna.
 * @param {import('exceljs').Cell} cell
 * @param {string} field
 * @param {*} value
 * @param {{ numFmt?: string|null }} [opts]
 */
export function applyAlfaExcelCellValue(cell, field, value, opts = {}) {
  if (!cell) return;
  cell.value = value;
  const fmt =
    opts.numFmt != null && opts.numFmt !== ''
      ? opts.numFmt
      : getAlfaExcelDefaultNumFmt(field);
  if (fmt && value != null && value !== '') {
    cell.numFmt = fmt;
  }
}

/**
 * Serial Excel (OADate) para Graph — fechas reales, no texto.
 * Usa día UTC del ISO (misma convención que toGraphRangeValue previo).
 * @param {Date|string|number} value
 * @returns {number|null}
 */
export function toExcelSerialDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const excelEpoch = Date.UTC(1899, 11, 30);
  return (day - excelEpoch) / 86400000;
}
