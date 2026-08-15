/**
 * Outbound Equidad FDM → Excel SharePoint (siniestro, ajustador, etc.).
 */

import XLSX from 'xlsx';
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

const HEADER_TO_FIELD = {
  SINIESTRO: 'siniestro',
  AJUSTADOR: 'ajustador',
  CASO: 'caso',
  ESTADO: 'estado',
  CELULAR: 'celular',
  TELEFONO: 'celular',
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
  CEDULA: 'cedula',
  IDENTIFICACION: 'cedula',
};

function cellDisplay(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
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

function mapHeaders(headerRow = []) {
  const colByField = {};
  headerRow.forEach((cell, idx) => {
    const h = normHeader(cell);
    let field = HEADER_TO_FIELD[h];
    if (!field) {
      if (h.includes('INDEMNIZADO') && h.includes('AJUSTADOR')) field = 'valorIndemnizadoAjustador';
      else if (h === 'VALOR INDEMNIZADO' || (h.startsWith('VALOR INDEMNIZADO') && !h.includes('AJUSTADOR'))) {
        field = 'valorIndemnizado';
      } else if (h.includes('PERDIDA') && h.includes('CONTENIDO')) field = 'perdidaContenidos';
      else if (h.includes('PERDIDA') && h.includes('EDIFICIO')) field = 'perdidaEdificio';
      else if (h.includes('TOTAL') && h.includes('PERDIDA')) field = 'totalPerdida';
      else if (h.includes('TOTAL') && h.includes('LIQUIDADO')) field = 'totalLiquidado';
      else if (h.includes('VALORES') && h.includes('INDEMNIZ')) field = 'valoresIndemnizables';
      else if (h === 'EDIFCIO' || h === 'EDIFICIO' || h.includes('VALOR EDIFICIO')) field = 'valorEdificio';
      else if (h === 'CONTENIDO' || h.includes('VALOR CONTENIDO')) field = 'valorContenido';
    }
    if (field && colByField[field] == null) colByField[field] = idx;
  });
  return colByField;
}

function findRowByCedula(rows, headerIdx, colCedula, cedula) {
  const target = String(cedula || '').replace(/\D/g, '');
  if (!target || colCedula == null) return -1;
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const digits = String(row[colCedula] ?? '').replace(/\D/g, '');
    if (digits && digits === target) return i;
  }
  return -1;
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
  const cfg = getEquidadFdmExcelSharePointConfig();
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
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const headerIdx = rows.findIndex(
    (r) => Array.isArray(r) && r.some((c) => /CEDULA|IDENTIFICACION/i.test(String(c)))
  );
  if (headerIdx < 0) {
    const err = new Error('No se encontró encabezado CEDULA en el Excel');
    err.code = 'HEADER_NOT_FOUND';
    throw err;
  }

  const colByField = mapHeaders(rows[headerIdx]);
  const rowIdx = findRowByCedula(rows, headerIdx, colByField.cedula, caso.cedula);
  if (rowIdx < 0) {
    doc.status = 'skipped';
    doc.lastError = 'Fila no encontrada por cédula en Excel';
    await doc.save();
    return { skipped: true, reason: 'ROW_NOT_FOUND' };
  }

  const changes = doc.changes || {};
  for (const field of Object.keys(changes)) {
    const col = colByField[field];
    if (col == null) continue;
    const to = changes[field]?.to !== undefined ? changes[field].to : caso[field];
    rows[rowIdx][col] = cellDisplay(to);
  }

  const newSheet = XLSX.utils.aoa_to_sheet(rows);
  wb.Sheets[sheetName] = newSheet;
  const outBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

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
      doc.status = 'pending';
      doc.lastError = error.message || String(error);
      if (doc.attempts >= cfg.outboundMaxAttempts) {
        doc.status = 'error';
      } else {
        doc.nextRetryAt = nextRetryAt(doc.attempts);
      }
      await doc.save();
    }
  }

  return summary;
}
