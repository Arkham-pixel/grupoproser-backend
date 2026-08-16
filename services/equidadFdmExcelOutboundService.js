/**
 * Outbound Equidad FDM → Excel SharePoint (siniestro, ajustador, etc.).
 * Escribe celdas con ExcelJS para no romper formato/estilos del libro.
 */

import ExcelJS from 'exceljs';
import {
  getEquidadFdmExcelSharePointConfig,
  FDM_EXCEL_OUTBOUND_FIELDS,
} from '../config/equidadFdmExcelSharePoint.js';
import {
  downloadDriveItemBuffer,
  replaceDriveItemContentBuffer,
  getItemMetadata,
  resolveDriveContext,
} from './microsoftGraphService.js';
import EquidadFdmExcelOutboundUpdate from '../models/EquidadFdmExcelOutboundUpdate.js';
import EquidadFdmExcelSharePointSource from '../models/EquidadFdmExcelSharePointSource.js';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';

const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

function nextRetryAt(attempts) {
  const idx = Math.min(Math.max(0, attempts - 1), RETRY_MS.length - 1);
  return new Date(Date.now() + RETRY_MS[idx]);
}

function normHeader(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function headerCellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) {
      return value.richText.map((p) => p.text || '').join('');
    }
  }
  return String(value);
}

const HEADER_TO_FIELD = {
  SINIESTRO: 'siniestro',
  'SINIESTRO INDEMNIZADO': 'siniestroIndemnizado',
  'SINIESTRO O INDEMNIZADO': 'siniestroIndemnizado',
  'SINIESTRO O AFECTACION': 'siniestroIndemnizado',
  AJUSTADOR: 'ajustador',
  CASO: 'caso',
  ESTADO: 'estado',
  CELULAR: 'celular',
  TELEFONO: 'celular',
  CORREO: 'correo',
  'CORREO ELECTRONICO': 'correo',
  EMAIL: 'correo',
  OBSERVACIONES: 'observaciones',
  EDIFCIO: 'valorEdificio',
  EDIFICIO: 'valorEdificio',
  'VALOR EDIFICIO': 'valorEdificio',
  CONTENIDO: 'valorContenido',
  'VALOR CONTENIDO': 'valorContenido',
  'VALORES QUE SE PUEDE INDEMNIZAR': 'valoresIndemnizables',
  'VALORES INDEMNIZABLES': 'valoresIndemnizables',
  'PERDIDA POR CONTENIDOS': 'perdidaContenidos',
  'PERDIDA POR EDIFICIO': 'perdidaEdificio',
  'TOTAL PERDIDA': 'totalPerdida',
  DEDUCIBLE: 'deducible',
  SUBSIDIO: 'subsidio',
  'TOTAL LIQUIDADO': 'totalLiquidado',
  'VALOR INDEMNIZADO AJUSTADOR': 'valorIndemnizadoAjustador',
  'VALOR INDEMNIZADO': 'valorIndemnizado',
  'FECHA DE LIQUIDACION': 'fechaLiquidacion',
  'FECHA LIQUIDACION': 'fechaLiquidacion',
  'FECHA DE GIRO': 'fechaGiro',
  'FECHA GIRO': 'fechaGiro',
  CEDULA: 'cedula',
  IDENTIFICACION: 'cedula',
};

function cellDisplay(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value.slice(0, 10) : d;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const asNum = Number(String(value).replace(/[^\d.-]/g, ''));
  if (String(value).trim() !== '' && Number.isFinite(asNum) && /^-?\d/.test(String(value).trim())) {
    return asNum;
  }
  return value;
}

export function buildEquidadFdmOutboundChanges(before = {}, after = {}) {
  const changes = {};
  for (const field of FDM_EXCEL_OUTBOUND_FIELDS) {
    const prev = before?.[field];
    const next = after?.[field];
    const prevN = prev == null || prev === '' ? null : Number(prev);
    const nextN = next == null || next === '' ? null : Number(next);
    if (Number.isFinite(prevN) && Number.isFinite(nextN)) {
      if (Math.abs(prevN - nextN) > 0.009) {
        changes[field] = { from: prev ?? null, to: next ?? null };
      }
      continue;
    }
    const prevS = prev == null ? '' : String(prev);
    const nextS = next == null ? '' : String(next);
    if (prevS !== nextS) {
      changes[field] = { from: prev ?? null, to: next ?? null };
    }
  }
  return changes;
}

export async function enqueueEquidadFdmExcelOutboundFromCaseUpdate(casoId, before, after) {
  const cfg = getEquidadFdmExcelSharePointConfig();
  if (!cfg.outboundCronEnabled) return null;

  const changes = buildEquidadFdmOutboundChanges(before, after);
  if (!Object.keys(changes).length) return null;

  const caso = after || (await EquidadFdmCaso.findById(casoId).lean());
  if (!caso) return null;

  const existing = await EquidadFdmExcelOutboundUpdate.findOne({
    casoId,
    status: 'pending',
  });
  if (existing) {
    existing.changes = { ...(existing.changes || {}), ...changes };
    existing.consecutivo = caso.consecutivo;
    existing.cedula = caso.cedula;
    await existing.save();
    return existing.toObject();
  }

  const doc = await EquidadFdmExcelOutboundUpdate.create({
    casoId,
    consecutivo: caso.consecutivo,
    cedula: caso.cedula,
    status: 'pending',
    changes,
  });
  return doc.toObject();
}

function mapHeadersFromWorksheet(ws, headerRowNumber) {
  const colByField = {};
  const row = ws.getRow(headerRowNumber);
  const maxCol = Math.max(row.cellCount || 0, 50);
  for (let idx = 1; idx <= maxCol; idx += 1) {
    const h = normHeader(headerCellText(row.getCell(idx).value));
    if (!h) continue;
    let field = HEADER_TO_FIELD[h];
    if (!field) {
      if (h.startsWith('SINIESTRO ') && /(INDEMNIZ|AFECTAC)/.test(h)) {
        field = 'siniestroIndemnizado';
      } else if (h.includes('INDEMNIZADO') && h.includes('AJUSTADOR')) {
        field = 'valorIndemnizadoAjustador';
      } else if (
        h === 'VALOR INDEMNIZADO' ||
        (h.startsWith('VALOR INDEMNIZADO') && !h.includes('AJUSTADOR'))
      ) {
        field = 'valorIndemnizado';
      } else if (h.includes('PERDIDA') && h.includes('CONTENIDO')) field = 'perdidaContenidos';
      else if (h.includes('PERDIDA') && h.includes('EDIFICIO')) field = 'perdidaEdificio';
      else if (h.includes('TOTAL') && h.includes('PERDIDA')) field = 'totalPerdida';
      else if (h.includes('TOTAL') && h.includes('LIQUIDADO')) field = 'totalLiquidado';
      else if (h.includes('VALORES') && h.includes('INDEMNIZ')) field = 'valoresIndemnizables';
      else if (h === 'EDIFCIO' || h === 'EDIFICIO' || h.includes('VALOR EDIFICIO')) {
        field = 'valorEdificio';
      } else if (h === 'CONTENIDO' || h.includes('VALOR CONTENIDO')) field = 'valorContenido';
    }
    // siniestro solo si el encabezado es exactamente SINIESTRO
    if (field === 'siniestro' && h !== 'SINIESTRO') continue;
    // ajustador solo exacto: no confundir con VALOR INDEMNIZADO(AJUSTADOR)
    if (field === 'ajustador' && h !== 'AJUSTADOR') continue;
    if (field && colByField[field] == null) colByField[field] = idx;
  }
  return colByField;
}

function findHeaderRowNumber(ws) {
  const maxScan = Math.min(ws.rowCount || 30, 40);
  for (let r = 1; r <= maxScan; r += 1) {
    const row = ws.getRow(r);
    let hit = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const h = normHeader(headerCellText(cell.value));
      if (h.includes('CEDULA') || h.includes('IDENTIFICACION')) hit = true;
    });
    if (hit) return r;
  }
  return -1;
}

function findRowByCedulaExcelJs(ws, headerRowNumber, colCedula, cedula) {
  const target = String(cedula || '').replace(/\D/g, '');
  if (!target || colCedula == null) return -1;
  const maxRow = ws.rowCount || 0;
  for (let r = headerRowNumber + 1; r <= maxRow; r += 1) {
    const raw = headerCellText(ws.getRow(r).getCell(colCedula).value);
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits && digits === target) return r;
  }
  return -1;
}

function ensureWorksheetRowsVisible(ws) {
  if (!ws) return;
  if (ws.state === 'hidden' || ws.state === 'veryHidden') ws.state = 'visible';
  // Excel Online falla con "Can't display a hidden grid" si todas las filas quedan hidden.
  const maxRow = Math.max(ws.rowCount || 0, 1);
  for (let r = 1; r <= maxRow; r += 1) {
    const row = ws.getRow(r);
    if (row.hidden) row.hidden = false;
    if (row.height === 0) row.height = 15;
  }
  if (ws.autoFilter) ws.autoFilter = undefined;
}

async function resolveSourceItem() {
  const cfg = getEquidadFdmExcelSharePointConfig();
  const source = await EquidadFdmExcelSharePointSource.findOne({
    integrationKey: cfg.integrationKey,
  }).lean();
  if (source?.itemId) {
    const ctx = await resolveDriveContext();
    return {
      driveId: source.driveId || ctx.driveId,
      itemId: source.itemId,
      eTag: source.eTag,
      source,
    };
  }
  return null;
}

export async function processEquidadFdmExcelOutboundUpdate(doc) {
  const resolved = await resolveSourceItem();
  if (!resolved?.itemId) {
    const err = new Error('Excel Equidad FDM no localizado en SharePoint (corra un check primero)');
    err.code = 'EXCEL_NOT_LOCATED';
    throw err;
  }

  const caso = await EquidadFdmCaso.findById(doc.casoId).lean();
  if (!caso) {
    doc.status = 'skipped';
    doc.lastError = 'Caso eliminado';
    await doc.save();
    return { skipped: true };
  }

  const downloaded = await downloadDriveItemBuffer({
    driveId: resolved.driveId,
    itemId: resolved.itemId,
  });
  const buffer = downloaded?.buffer || downloaded;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) {
    const err = new Error('El Excel no tiene hojas');
    err.code = 'NO_SHEETS';
    throw err;
  }

  const headerIdx = findHeaderRowNumber(ws);
  if (headerIdx < 0) {
    const err = new Error('No se encontró encabezado CEDULA en el Excel');
    err.code = 'HEADER_NOT_FOUND';
    throw err;
  }

  const colByField = mapHeadersFromWorksheet(ws, headerIdx);
  if (colByField.fechaLiquidacion == null && colByField.fechaGiro != null) {
    colByField.fechaLiquidacion = colByField.fechaGiro;
  }
  const rowIdx = findRowByCedulaExcelJs(ws, headerIdx, colByField.cedula, caso.cedula);
  if (rowIdx < 0) {
    doc.status = 'skipped';
    doc.lastError = 'Fila no encontrada por cédula en Excel';
    await doc.save();
    return { skipped: true, reason: 'ROW_NOT_FOUND' };
  }

  const dataRow = ws.getRow(rowIdx);
  const changes = doc.changes || {};
  // Campos a escribir: los del cambio + siniestro/caso actuales del caso (por si el Excel quedó vacío).
  const fieldsToWrite = new Set([
    ...Object.keys(changes),
    ...(caso.siniestro ? ['siniestro'] : []),
    ...(caso.caso ? ['caso'] : []),
  ]);
  for (const field of fieldsToWrite) {
    const col = colByField[field];
    if (col == null) continue;
    const to =
      changes[field]?.to !== undefined && changes[field]?.to !== null && changes[field]?.to !== ''
        ? changes[field].to
        : caso[field];
    if (to == null || to === '') continue;
    const cell = dataRow.getCell(col);
    const display = cellDisplay(to);
    cell.value = display;
    if (display instanceof Date) {
      cell.numFmt = 'dd/mm/yyyy';
    }
  }
  dataRow.commit();
  ensureWorksheetRowsVisible(ws);

  const outBuf = Buffer.from(await wb.xlsx.writeBuffer());

  const cfg = getEquidadFdmExcelSharePointConfig();
  const metaBefore = await getItemMetadata(resolved.itemId);
  const uploaded = await replaceDriveItemContentBuffer({
    driveId: resolved.driveId,
    itemId: resolved.itemId,
    buffer: outBuf,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ifMatch: metaBefore.eTag || resolved.eTag,
  });

  const newEtag = uploaded?.eTag || uploaded?.id;
  await EquidadFdmExcelSharePointSource.findOneAndUpdate(
    { integrationKey: cfg.integrationKey },
    {
      $set: {
        lastArnaldWrittenEtag: newEtag || metaBefore.eTag,
        eTag: newEtag || metaBefore.eTag,
        lastSyncAt: new Date(),
      },
    }
  );

  doc.status = 'synced';
  doc.lastSyncedAt = new Date();
  doc.lastError = null;
  await doc.save();
  return { synced: true, eTag: newEtag };
}

export async function runEquidadFdmExcelOutboundCycle({ batchSize } = {}) {
  const cfg = getEquidadFdmExcelSharePointConfig();
  const limit = batchSize || cfg.outboundBatchSize;
  const now = new Date();
  const pending = await EquidadFdmExcelOutboundUpdate.find({
    status: 'pending',
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }],
  })
    .sort({ createdAt: 1 })
    .limit(limit);

  const summary = { processed: 0, synced: 0, skipped: 0, errors: 0 };

  for (const doc of pending) {
    summary.processed += 1;
    doc.status = 'processing';
    doc.attempts = (doc.attempts || 0) + 1;
    await doc.save();
    try {
      const result = await processEquidadFdmExcelOutboundUpdate(doc);
      if (result?.skipped) summary.skipped += 1;
      else summary.synced += 1;
    } catch (error) {
      summary.errors += 1;
      const code = error?.code || error?.graphCode || '';
      doc.status = 'pending';
      doc.lastError = error.message || String(error);
      if (code === 'EXCEL_SOURCE_LOCKED' || /SOURCE_LOCKED|locked/i.test(String(doc.lastError))) {
        doc.attempts = Math.max(0, (doc.attempts || 1) - 1);
        doc.nextRetryAt = new Date(Date.now() + 90_000);
      } else if (doc.attempts >= cfg.outboundMaxAttempts) {
        doc.status = 'error';
      } else {
        doc.nextRetryAt = nextRetryAt(doc.attempts);
      }
      await doc.save();
    }
  }

  return summary;
}
