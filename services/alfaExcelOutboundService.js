/**
 * ARNALD → Excel Control y Seguimiento (columnas amarillas allowlist).
 * Separado del importador inbound. Piloto: solo fechaUltimoDocumento → X.
 */

import ExcelJS from 'exceljs';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import {
  getAlfaExcelOutboundConfig,
  nextOutboundRetryAt,
} from '../config/alfaExcelOutbound.js';
import {
  ALFA_EXCEL_SHEET_NAME,
  ALFA_EXCEL_GREEN_COLUMNS,
  filterOutboundWritableChanges,
  getOwnershipEntry,
  assertFieldWritableOrThrow,
} from '../config/alfaExcelOwnershipMap.js';
import { ALFA_EXCEL_DATE_FIELDS, ALFA_EXCEL_MONEY_FIELDS } from '../config/alfaExcelColumnMap.js';
import { isAlfaOutboundEmptyValue } from '../utils/alfaExcelNormalize.js';
import {
  matchAlfaCaseForExcelRow,
  parseAlfaExcelBuffer,
} from './alfaExcelImportService.js';
import {
  resolveDriveContext,
  getItemMetadata,
  downloadDriveItemBuffer,
  replaceDriveItemContentBuffer,
  createWorkbookSession,
  closeWorkbookSession,
  updateWorkbookRange,
  clearWorkbookRange,
  readWorkbookRange,
} from './microsoftGraphService.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';

function logOut(event, payload = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...payload }));
}

function normKeyAddress(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function fieldValuesEqual(field, a, b) {
  if (ALFA_EXCEL_DATE_FIELDS.includes(field)) {
    const ta = a ? new Date(a).getTime() : null;
    const tb = b ? new Date(b).getTime() : null;
    if (ta == null && tb == null) return true;
    if (ta == null || tb == null) return false;
    return ta === tb;
  }
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    return Number(a) === Number(b);
  }
  return String(a) === String(b);
}

function serializeForOutbox(field, value) {
  if (value == null || value === '') return null;
  if (ALFA_EXCEL_DATE_FIELDS.includes(field)) {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (ALFA_EXCEL_MONEY_FIELDS.includes(field)) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

function toExcelCellValue(field, value) {
  if (value == null || value === '') return null;
  if (ALFA_EXCEL_DATE_FIELDS.includes(field)) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }
  if (ALFA_EXCEL_MONEY_FIELDS.includes(field)) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

function columnLetterToNumber(letter) {
  const s = String(letter || '').toUpperCase();
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n;
}

function changesMapToObject(changes) {
  if (!changes) return {};
  if (changes instanceof Map) return Object.fromEntries(changes.entries());
  if (typeof changes.toObject === 'function') return changes.toObject();
  return { ...changes };
}

/**
 * Diff before→after limitado a campos del caso; filtra allowlist piloto.
 */
export function buildOutboundCandidateChanges(beforeDoc, afterDoc) {
  const before = beforeDoc?.toObject?.() || beforeDoc || {};
  const after = afterDoc?.toObject?.() || afterDoc || {};
  const raw = {};

  const fields = new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ]);

  for (const field of fields) {
    if (field.startsWith('_') || field === 'archivos' || field === 'liquidador' || field === 'informeUnico') {
      continue;
    }
    if (field === 'createdAt' || field === 'updatedAt' || field === '__v') continue;
    if (field === 'controlSeguimientoExcel') continue;
    if (!Object.prototype.hasOwnProperty.call(after, field) && !Object.prototype.hasOwnProperty.call(before, field)) {
      continue;
    }
    const b = before[field];
    const a = after[field];
    if (fieldValuesEqual(field, b, a)) continue;
    raw[field] = {
      before: serializeForOutbox(field, b),
      after: serializeForOutbox(field, a),
    };
  }

  return filterOutboundWritableChanges(raw);
}

/**
 * Encola outbox tras save Mongo. Nunca lanza al request HTTP.
 */
export async function enqueueAlfaExcelOutboundFromCaseUpdate({
  beforeDoc,
  afterDoc,
} = {}) {
  try {
    if (!afterDoc?._id) return null;

    const { writable: rawWritable, rejected } = buildOutboundCandidateChanges(beforeDoc, afterDoc);
    const writable = {};
    for (const [field, diff] of Object.entries(rawWritable)) {
      if (isAlfaOutboundEmptyValue(diff.after)) {
        rejected.push({
          field,
          code: 'SKIP_EMPTY_DOES_NOT_CLEAR',
          reason: 'ARNALD vacío no borra dato lleno en Excel',
        });
        logOut('ALFA_EXCEL_OUTBOUND_SKIP_EMPTY', {
          caseId: String(afterDoc._id),
          consecutivo: afterDoc.consecutivo || null,
          field,
        });
        continue;
      }
      writable[field] = diff;
    }

    for (const r of rejected) {
      if (r.code === 'OUTBOUND_FIELD_NOT_MAPPED' || r.code === 'ALFA_EXCEL_FIELD_NOT_WRITABLE') {
        logOut('OUTBOUND_FIELD_NOT_MAPPED', {
          caseId: String(afterDoc._id),
          consecutivo: afterDoc.consecutivo || null,
          field: r.field,
          code: r.code,
          reason: r.reason,
        });
      }
    }

    const writableKeys = Object.keys(writable);
    if (writableKeys.length === 0) return null;

    // Validación dura: solo columnas allowlist habilitadas
    for (const field of writableKeys) {
      assertFieldWritableOrThrow(field);
    }

    let doc = await AlfaExcelOutboundUpdate.findOne({
      caseId: afterDoc._id,
      status: 'pending',
    });

    if (doc) {
      const merged = changesMapToObject(doc.changes);
      for (const [field, diff] of Object.entries(writable)) {
        merged[field] = diff;
      }
      doc.changes = merged;
      doc.rejectedAtEnqueue = rejected;
      doc.consecutivo = afterDoc.consecutivo || doc.consecutivo;
      doc.nextRetryAt = new Date();
      await doc.save();
    } else {
      doc = await AlfaExcelOutboundUpdate.create({
        caseId: afterDoc._id,
        consecutivo: afterDoc.consecutivo || null,
        source: 'arnald',
        status: 'pending',
        changes: writable,
        rejectedAtEnqueue: rejected,
        attempts: 0,
        nextRetryAt: new Date(),
      });
    }

    await SegurosAlfaCaso.updateOne(
      { _id: afterDoc._id },
      {
        $set: {
          controlSeguimientoExcel: {
            status: 'pending',
            lastOutboundId: doc._id,
            lastError: null,
            updatedAt: new Date(),
          },
        },
      }
    );

    logOut('ALFA_EXCEL_OUTBOUND_ENQUEUED', {
      outboundId: String(doc._id),
      caseId: String(afterDoc._id),
      consecutivo: afterDoc.consecutivo || null,
      fields: writableKeys,
      columns: writableKeys.map((f) => writable[f].column),
    });

    return doc;
  } catch (error) {
    logOut('ALFA_EXCEL_OUTBOUND_ENQUEUE_ERROR', {
      caseId: afterDoc?._id ? String(afterDoc._id) : null,
      error: error.message,
      code: error.code || null,
    });
    return null;
  }
}

/**
 * Localiza fila Excel inequívoca para el caso (matching inverso).
 */
export function findExcelRowForCase(caseDoc, excelRows) {
  const hits = [];
  for (const row of excelRows) {
    const match = matchAlfaCaseForExcelRow(row.payload, [caseDoc]);
    if (
      match.actionHint === 'MATCH' &&
      match.cases?.length === 1 &&
      String(match.cases[0]._id) === String(caseDoc._id)
    ) {
      hits.push({
        rowNumber: row.rowNumber,
        strategy: match.matchStrategy || match.strategy,
        evidence: match.matchEvidence || match.evidence,
        payload: row.payload,
      });
    }
  }

  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    // Preferir coincidencia exacta de dirección cuando hay varias filas ID+póliza
    const dirCaso = normKeyAddress(caseDoc?.direccionPredio);
    if (dirCaso) {
      const byDir = hits.filter(
        (h) => normKeyAddress(h.payload?.direccionPredio) === dirCaso
      );
      if (byDir.length === 1) {
        return {
          rowNumber: byDir[0].rowNumber,
          strategy: `${byDir[0].strategy}+DIRECCION`,
          evidence: { ...(byDir[0].evidence || {}), direccionPredio: true },
        };
      }
      if (byDir.length > 1) {
        // Filas Excel duplicadas (misma ID/póliza/dirección): tomar la primera
        byDir.sort((a, b) => a.rowNumber - b.rowNumber);
        logOut('ALFA_EXCEL_OUTBOUND_DUPLICATE_ROWS_PICKED', {
          consecutivo: caseDoc?.consecutivo || null,
          pickedRow: byDir[0].rowNumber,
          candidates: byDir.map((h) => h.rowNumber),
        });
        return {
          rowNumber: byDir[0].rowNumber,
          strategy: `${byDir[0].strategy}+FIRST_DUPLICATE`,
          evidence: byDir[0].evidence,
        };
      }
    }
    const err = new Error('AMBIGUOUS_EXCEL_ROW');
    err.code = 'AMBIGUOUS_EXCEL_ROW';
    err.candidates = hits.map((h) => ({
      rowNumber: h.rowNumber,
      strategy: h.strategy,
    }));
    throw err;
  }
  const err = new Error('EXCEL_ROW_NOT_FOUND');
  err.code = 'EXCEL_ROW_NOT_FOUND';
  throw err;
}

async function resolveSourceExcel() {
  const cfg = getAlfaExcelOutboundConfig();
  const importCfg = getAlfaExcelSharePointImportConfig();
  const source = await AlfaExcelSharePointSource.findOne({
    integrationKey: cfg.integrationKey,
  });
  const ctx = await resolveDriveContext();

  let itemId = source?.itemId;
  let fileName = source?.fileName || cfg.fileName || importCfg.fileName;
  let driveId = source?.driveId || ctx.driveId;

  if (!itemId) {
    const err = new Error('EXCEL_SOURCE_NOT_CONFIGURED');
    err.code = 'EXCEL_SOURCE_NOT_CONFIGURED';
    throw err;
  }

  const meta = await getItemMetadata(itemId);
  return {
    source,
    driveId: meta.parentReference?.driveId || driveId,
    itemId: meta.id,
    fileName: meta.name || fileName,
    eTag: meta.eTag,
    meta,
  };
}

/**
 * Escribe SOLO celdas allowlist en la fila indicada. No crea columnas.
 * Devuelve buffer + verificación de que solo cambiaron esas columnas.
 */
export async function patchYellowCellsInWorkbookBuffer({
  buffer,
  sheetName,
  excelRowNumber,
  cellUpdates,
}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws =
    wb.getWorksheet(sheetName) ||
    wb.worksheets.find(
      (w) => String(w.name).trim().toUpperCase() === String(sheetName).trim().toUpperCase()
    );
  if (!ws) {
    const err = new Error(`EXCEL_SHEET_NOT_FOUND:${sheetName}`);
    err.code = 'EXCEL_SHEET_NOT_FOUND';
    throw err;
  }

  const headerRow = ws.getRow(1);
  const dataRow = ws.getRow(excelRowNumber);
  const maxCol = Math.max(28, headerRow.cellCount || 0);

  const snapshotValue = (cell) => {
    const v = cell.value;
    if (v == null || v === '') return null;
    if (v instanceof Date) return `d:${v.getTime()}`;
    if (typeof v === 'object' && v.result != null) return `r:${String(v.result)}`;
    if (typeof v === 'object' && v.text != null) return `t:${String(v.text)}`;
    if (typeof v === 'number') return `n:${v}`;
    return `s:${String(v)}`;
  };

  const beforeSnap = {};
  for (let c = 1; c <= maxCol; c += 1) {
    beforeSnap[c] = snapshotValue(dataRow.getCell(c));
  }

  const headerCountBefore = (() => {
    let n = 0;
    headerRow.eachCell({ includeEmpty: false }, () => {
      n += 1;
    });
    return n;
  })();

  const allowedCols = new Set();
  for (const upd of cellUpdates) {
    const colNum = columnLetterToNumber(upd.column);
    const headerVal = headerRow.getCell(colNum).value;
    const headerText =
      headerVal == null
        ? ''
        : typeof headerVal === 'object' && headerVal.text != null
          ? String(headerVal.text)
          : String(headerVal);
    if (!headerText.trim()) {
      const err = new Error(`OUTBOUND_COLUMN_MISSING_HEADER:${upd.column}`);
      err.code = 'OUTBOUND_COLUMN_MISSING_HEADER';
      throw err;
    }
    assertFieldWritableOrThrow(upd.field);
    const entry = getOwnershipEntry(upd.field);
    if (entry.column !== upd.column) {
      const err = new Error(`OUTBOUND_COLUMN_MISMATCH:${upd.field}`);
      err.code = 'OUTBOUND_COLUMN_MISMATCH';
      throw err;
    }

    if (isAlfaOutboundEmptyValue(upd.value)) {
      continue;
    }
    allowedCols.add(colNum);
    const cell = dataRow.getCell(colNum);
    cell.value = toExcelCellValue(upd.field, upd.value);
    if (ALFA_EXCEL_DATE_FIELDS.includes(upd.field) && cell.value instanceof Date) {
      cell.numFmt = 'dd/mm/yyyy';
    }
  }

  const afterSnap = {};
  for (let c = 1; c <= maxCol; c += 1) {
    afterSnap[c] = snapshotValue(dataRow.getCell(c));
  }

  for (let c = 1; c <= maxCol; c += 1) {
    if (allowedCols.has(c)) continue;
    if (beforeSnap[c] !== afterSnap[c]) {
      const err = new Error(`OUTBOUND_UNEXPECTED_CELL_CHANGE:col=${c}`);
      err.code = 'OUTBOUND_UNEXPECTED_CELL_CHANGE';
      throw err;
    }
  }

  let headerCountAfter = 0;
  headerRow.eachCell({ includeEmpty: false }, () => {
    headerCountAfter += 1;
  });
  if (headerCountAfter !== headerCountBefore) {
    const err = new Error('OUTBOUND_HEADER_COUNT_CHANGED');
    err.code = 'OUTBOUND_HEADER_COUNT_CHANGED';
    throw err;
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

function toGraphRangeValue(field, value) {
  if (value == null || value === '') return '';
  if (ALFA_EXCEL_DATE_FIELDS.includes(field)) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }
  if (ALFA_EXCEL_MONEY_FIELDS.includes(field)) {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(n)) return '';
    return n;
  }
  if (typeof value === 'number') return value;
  return String(value);
}

function isClearValue(value) {
  return value == null || value === '';
}

function graphCellIsEmpty(range) {
  const v = range?.values?.[0]?.[0];
  const t = range?.text?.[0]?.[0];
  if (v == null || v === '') {
    if (t == null || String(t).trim() === '') return true;
  }
  if (typeof v === 'string' && v.trim() === '') return true;
  if (t != null && String(t).trim() === '' && (v == null || v === '')) return true;
  return false;
}

function graphCellMatchesExpected(field, expected, range) {
  if (isClearValue(expected)) return graphCellIsEmpty(range);
  const raw = range?.values?.[0]?.[0];
  const text = range?.text?.[0]?.[0];

  if (ALFA_EXCEL_DATE_FIELDS.includes(field)) {
    const exp = new Date(expected);
    if (Number.isNaN(exp.getTime())) return false;
    const expDay = exp.toISOString().slice(0, 10);
    if (typeof raw === 'number') {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const asDate = new Date(excelEpoch + raw * 86400000);
      return asDate.toISOString().slice(0, 10) === expDay;
    }
    const s = String(text || raw || '');
    return (
      s.startsWith(expDay) ||
      (s.includes(expDay.slice(8, 10)) &&
        s.includes(expDay.slice(5, 7)) &&
        s.includes(expDay.slice(0, 4)))
    );
  }

  if (ALFA_EXCEL_MONEY_FIELDS.includes(field)) {
    const expN = typeof expected === 'number' ? expected : Number(expected);
    if (!Number.isFinite(expN)) return false;
    if (typeof raw === 'number') return Math.abs(raw - expN) < 0.01;
    const parsed = Number(String(raw ?? text ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) && Math.abs(parsed - expN) < 0.01;
  }

  // estado y strings
  const expS = String(expected).trim();
  const rawS = raw == null ? '' : String(raw).trim();
  const textS = text == null ? '' : String(text).trim();
  return rawS === expS || textS === expS;
}

function snapshotRangeKey(range) {
  const v = range?.values?.[0]?.[0];
  const t = range?.text?.[0]?.[0];
  return JSON.stringify({ v: v ?? null, t: t == null ? null : String(t) });
}

/**
 * Escritura preferida: Graph Excel API (celdas), sin reemplazar el XLSX.
 * Borrado explícito (after=null/'') → clear Contents.
 * Tras escribir, relee la celda; si no cuadra → OUTBOUND_CELL_VERIFY_FAILED
 * También verifica que columnas verdes (A–Q) y amarillas no tocadas no cambiaron.
 * Fallback: ExcelJS + PUT /content con If-Match.
 */
async function writeOutboundCells({
  driveId,
  itemId,
  sheetName,
  excelRowNumber,
  cellUpdates,
  eTagBefore,
  downloadedBuffer,
}) {
  let sessionId = null;
  try {
    const session = await createWorkbookSession({
      driveId,
      itemId,
      persistChanges: true,
    });
    sessionId = session?.id;
    if (!sessionId) throw new Error('NO_WORKBOOK_SESSION');

    const touchedCols = new Set(cellUpdates.map((u) => u.column));
    const guardCols = [
      ...ALFA_EXCEL_GREEN_COLUMNS,
      ...['R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB'].filter(
        (c) => !touchedCols.has(c)
      ),
    ];

    const beforeGuards = {};
    for (const col of guardCols) {
      const address = `${col}${excelRowNumber}`;
      const range = await readWorkbookRange({
        driveId,
        itemId,
        worksheetName: sheetName,
        address,
        sessionId,
      });
      beforeGuards[col] = snapshotRangeKey(range);
    }

    for (const upd of cellUpdates) {
      assertFieldWritableOrThrow(upd.field);
      const address = `${upd.column}${excelRowNumber}`;
      if (isClearValue(upd.value) || isAlfaOutboundEmptyValue(upd.value)) {
        logOut('ALFA_EXCEL_OUTBOUND_SKIP_CLEAR', {
          field: upd.field,
          column: upd.column,
          reason: 'ARNALD vacío no borra Excel',
        });
        continue;
      }
      await updateWorkbookRange({
        driveId,
        itemId,
        worksheetName: sheetName,
        address,
        values: [[toGraphRangeValue(upd.field, upd.value)]],
        sessionId,
      });
    }

    // Verificar celdas escritas
    const verified = [];
    for (const upd of cellUpdates) {
      if (isClearValue(upd.value) || isAlfaOutboundEmptyValue(upd.value)) continue;
      const address = `${upd.column}${excelRowNumber}`;
      const range = await readWorkbookRange({
        driveId,
        itemId,
        worksheetName: sheetName,
        address,
        sessionId,
      });
      if (!graphCellMatchesExpected(upd.field, upd.value, range)) {
        const err = new Error(
          `OUTBOUND_CELL_VERIFY_FAILED:${address} expected=${JSON.stringify(upd.value)} got=${JSON.stringify(range?.values?.[0]?.[0])}`
        );
        err.code = 'OUTBOUND_CELL_VERIFY_FAILED';
        err.verify = {
          address,
          expected: upd.value,
          actualValue: range?.values?.[0]?.[0] ?? null,
          actualText: range?.text?.[0]?.[0] ?? null,
        };
        throw err;
      }
      verified.push({
        address,
        expected: upd.value,
        actualValue: range?.values?.[0]?.[0] ?? null,
        actualText: range?.text?.[0]?.[0] ?? null,
      });
    }

    // Verificar que no se tocaron verdes ni otras amarillas
    for (const col of guardCols) {
      const address = `${col}${excelRowNumber}`;
      const range = await readWorkbookRange({
        driveId,
        itemId,
        worksheetName: sheetName,
        address,
        sessionId,
      });
      const afterKey = snapshotRangeKey(range);
      if (afterKey !== beforeGuards[col]) {
        const err = new Error(`OUTBOUND_UNEXPECTED_CELL_CHANGE:${address}`);
        err.code = 'OUTBOUND_UNEXPECTED_CELL_CHANGE';
        err.verify = {
          address,
          before: beforeGuards[col],
          after: afterKey,
        };
        throw err;
      }
    }

    await closeWorkbookSession({ driveId, itemId, sessionId });
    sessionId = null;

    const metaAfter = await getItemMetadata(itemId);
    return {
      strategy: 'graph_workbook_range',
      eTagAfter: metaAfter.eTag,
      item: metaAfter,
      verified,
    };
  } catch (error) {
    if (sessionId) {
      await closeWorkbookSession({ driveId, itemId, sessionId });
    }
    if (
      error.code === 'OUTBOUND_CELL_VERIFY_FAILED' ||
      error.code === 'OUTBOUND_UNEXPECTED_CELL_CHANGE'
    ) {
      throw error;
    }
    logOut('ALFA_EXCEL_OUTBOUND_GRAPH_RANGE_FALLBACK', {
      error: error.message,
      code: error.code || null,
      status: error.status || null,
    });

    const patchedBuffer = await patchYellowCellsInWorkbookBuffer({
      buffer: downloadedBuffer,
      sheetName,
      excelRowNumber,
      cellUpdates,
    });
    const uploaded = await replaceDriveItemContentBuffer({
      driveId,
      itemId,
      buffer: patchedBuffer,
      ifMatch: eTagBefore,
    });
    const eTagAfter = uploaded?.eTag || (await getItemMetadata(itemId)).eTag;
    return {
      strategy: 'exceljs_put_content',
      eTagAfter,
      item: uploaded,
      verified: null,
    };
  }
}

async function markCaseSync(caseId, patch) {
  await SegurosAlfaCaso.updateOne(
    { _id: caseId },
    { $set: { controlSeguimientoExcel: { ...patch, updatedAt: new Date() } } }
  );
}

/**
 * Procesa un documento outbox (claimed processing).
 */
export async function processAlfaExcelOutboundUpdate(doc) {
  const cfg = getAlfaExcelOutboundConfig();
  const outboundId = String(doc._id);

  logOut('ALFA_EXCEL_OUTBOUND_PROCESSING', {
    outboundId,
    caseId: String(doc.caseId),
    consecutivo: doc.consecutivo || null,
    attempt: doc.attempts,
  });

  try {
    const changes = changesMapToObject(doc.changes);
    const fields = Object.keys(changes);
    if (fields.length === 0) {
      doc.status = 'cancelled';
      doc.lastError = 'empty changes';
      await doc.save();
      return { outcome: 'cancelled' };
    }

    for (const field of fields) {
      assertFieldWritableOrThrow(field);
    }

    const caseDoc = await SegurosAlfaCaso.findById(doc.caseId).lean();
    if (!caseDoc) {
      doc.status = 'failed';
      doc.lastErrorCode = 'CASE_NOT_FOUND';
      doc.lastError = 'Caso no encontrado';
      await doc.save();
      return { outcome: 'failed', code: 'CASE_NOT_FOUND' };
    }

    const resolved = await resolveSourceExcel();
    const eTagBefore = resolved.eTag;

    const downloaded = await downloadDriveItemBuffer({
      driveId: resolved.driveId,
      itemId: resolved.itemId,
    });

    // Releer eTag justo antes de modificar (concurrencia)
    const metaFresh = await getItemMetadata(resolved.itemId);
    if (metaFresh.eTag !== eTagBefore) {
      const err = new Error('EXCEL_SOURCE_ETAG_CHANGED');
      err.code = 'EXCEL_SOURCE_ETAG_CHANGED';
      throw err;
    }

    const parsed = parseAlfaExcelBuffer(downloaded.buffer);
    const hit = findExcelRowForCase(caseDoc, parsed.rows);

    const cellUpdates = fields
      .filter((field) => !isAlfaOutboundEmptyValue(changes[field].after))
      .map((field) => ({
        field,
        column: changes[field].column || getOwnershipEntry(field).column,
        value: changes[field].after,
      }));
    if (cellUpdates.length === 0) {
      doc.status = 'cancelled';
      doc.lastError = 'empty after skip: ARNALD vacío no borra Excel';
      await doc.save();
      return { outcome: 'cancelled', code: 'SKIP_EMPTY_DOES_NOT_CLEAR' };
    }

    const written = await writeOutboundCells({
      driveId: resolved.driveId,
      itemId: resolved.itemId,
      sheetName: parsed.sheetName || ALFA_EXCEL_SHEET_NAME,
      excelRowNumber: hit.rowNumber,
      cellUpdates,
      eTagBefore,
      downloadedBuffer: downloaded.buffer,
    });

    const eTagAfter = written.eTagAfter;

    doc.status = 'synced';
    doc.syncedAt = new Date();
    doc.lastError = null;
    doc.lastErrorCode = null;
    doc.match = {
      excelRowNumber: hit.rowNumber,
      strategy: hit.strategy,
      evidence: hit.evidence,
    };
    doc.sourceExcel = {
      itemId: resolved.itemId,
      driveId: resolved.driveId,
      fileName: resolved.fileName,
      sheetName: parsed.sheetName || ALFA_EXCEL_SHEET_NAME,
      eTagBefore,
      eTagAfter,
      columnsWritten: cellUpdates.map((u) => u.column),
      writeStrategy: written.strategy,
      verified: written.verified || null,
    };
    await doc.save();

    // Checkpoint anti-loop
    if (resolved.source) {
      resolved.source.lastArnaldWrittenEtag = eTagAfter;
      resolved.source.eTag = eTagAfter;
      resolved.source.lastPreviewedEtag = eTagAfter;
      resolved.source.lastDetectedEtag = eTagAfter;
      resolved.source.hasChanges = false;
      resolved.source.hasIncidents = false;
      resolved.source.status = 'up_to_date';
      resolved.source.lastOutcome = 'SKIP_ARNALD_GENERATED_VERSION';
      resolved.source.lastSyncAt = new Date();
      resolved.source.lastError = null;
      if (resolved.source.notification) {
        resolved.source.notification.pending = false;
      }
      await resolved.source.save();
    }

    await markCaseSync(doc.caseId, {
      status: 'synced',
      lastOutboundId: doc._id,
      lastSyncedAt: new Date(),
      lastError: null,
    });

    logOut('ALFA_EXCEL_OUTBOUND_SYNCED', {
      outboundId,
      caseId: String(doc.caseId),
      consecutivo: doc.consecutivo || null,
      excelRowNumber: hit.rowNumber,
      fields,
      columnsWritten: cellUpdates.map((u) => u.column),
      eTagBefore,
      eTagAfter,
      writeStrategy: written.strategy,
    });

    return {
      outcome: 'synced',
      excelRowNumber: hit.rowNumber,
      eTagBefore,
      eTagAfter,
      columnsWritten: cellUpdates.map((u) => u.column),
      writeStrategy: written.strategy,
    };
  } catch (error) {
    const code = error.code || 'OUTBOUND_FAILED';
    doc.attempts = (doc.attempts || 0) + 1;
    doc.lastAttemptAt = new Date();
    doc.lastError = error.message || String(error);
    doc.lastErrorCode = code;

    if (code === 'EXCEL_SOURCE_ETAG_CHANGED') {
      logOut('ALFA_EXCEL_OUTBOUND_ETAG_CONFLICT', {
        outboundId,
        caseId: String(doc.caseId),
        attempt: doc.attempts,
      });
    }
    if (code === 'EXCEL_SOURCE_LOCKED' || code === 'notAllowed') {
      logOut('ALFA_EXCEL_OUTBOUND_LOCKED', {
        outboundId,
        caseId: String(doc.caseId),
        attempt: doc.attempts,
      });
    }

    const maxAttempts = cfg.maxAttempts;
    if (
      doc.attempts >= maxAttempts ||
      code === 'AMBIGUOUS_EXCEL_ROW' ||
      code === 'ALFA_EXCEL_FIELD_NOT_WRITABLE' ||
      code === 'OUTBOUND_CELL_VERIFY_FAILED' ||
      code === 'OUTBOUND_UNEXPECTED_CELL_CHANGE'
    ) {
      doc.status = 'failed';
      doc.nextRetryAt = null;
      await markCaseSync(doc.caseId, {
        status: 'failed',
        lastOutboundId: doc._id,
        lastError: doc.lastError,
      });
    } else {
      doc.status = 'pending';
      doc.nextRetryAt = nextOutboundRetryAt(doc.attempts);
      await markCaseSync(doc.caseId, {
        status: 'pending',
        lastOutboundId: doc._id,
        lastError: doc.lastError,
      });
    }
    await doc.save();

    logOut('ALFA_EXCEL_OUTBOUND_FAILED', {
      outboundId,
      caseId: String(doc.caseId),
      code,
      error: doc.lastError,
      attempts: doc.attempts,
      status: doc.status,
      nextRetryAt: doc.nextRetryAt,
    });

    return { outcome: doc.status, code, error: doc.lastError };
  }
}

/**
 * Claim batch pending → processing y ejecutar.
 */
export async function runAlfaExcelOutboundCycle({ batchSize } = {}) {
  const cfg = getAlfaExcelOutboundConfig();
  const size = batchSize ?? cfg.batchSize;
  const now = new Date();

  const ids = await AlfaExcelOutboundUpdate.find({
    status: 'pending',
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }],
  })
    .sort({ nextRetryAt: 1, createdAt: 1 })
    .limit(size)
    .select('_id')
    .lean();

  const results = [];
  for (const { _id } of ids) {
    const claimed = await AlfaExcelOutboundUpdate.findOneAndUpdate(
      { _id, status: 'pending' },
      { $set: { status: 'processing', lastAttemptAt: new Date() } },
      { new: true }
    );
    if (!claimed) continue;
    const result = await processAlfaExcelOutboundUpdate(claimed);
    results.push({ id: String(_id), ...result });
  }

  return {
    claimed: results.length,
    synced: results.filter((r) => r.outcome === 'synced').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
    pending: results.filter((r) => r.outcome === 'pending').length,
    results,
  };
}
