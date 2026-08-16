/**
 * Lógica compartida de casos Seguros Alfa (creación / consecutivo / payload).
 */

import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { PROTECTED_ALFA_FIELDS } from '../config/alfaExcelColumnMap.js';
import {
  mergeAlfaImportValue,
  valuesEqualForDiff,
  normalizeDate,
  isPolicyPlaceholder,
} from '../utils/alfaExcelNormalize.js';

const COUNTER_ID = 'seguros_alfa_consecutivo';

const ConsecutivoCounterSchema = new mongoose.Schema(
  {
    _id: { type: String },
    seq: { type: Number, default: 0 },
  },
  { collection: 'alfa_counters' }
);

const AlfaCounter =
  mongoose.models.AlfaCounter || mongoose.model('AlfaCounter', ConsecutivoCounterSchema);

let counterSeeded = false;

async function seedCounterFromExisting() {
  if (counterSeeded) return;
  const patron = /^ALFA-(\d{4})-(\d{2})-(\d+)$/i;
  const registros = await SegurosAlfaCaso.find({
    consecutivo: { $exists: true, $nin: [null, ''] },
  })
    .select('consecutivo')
    .lean();
  let maxSecuencial = 0;
  for (const reg of registros) {
    const match = String(reg.consecutivo || '').trim().match(patron);
    if (match?.[3]) {
      const n = parseInt(match[3], 10);
      if (!Number.isNaN(n) && n > maxSecuencial) maxSecuencial = n;
    }
  }
  await AlfaCounter.findOneAndUpdate(
    { _id: COUNTER_ID },
    { $max: { seq: maxSecuencial } },
    { upsert: true }
  );
  counterSeeded = true;
}

/** Genera ALFA-YYYY-MM-N de forma atómica. */
export async function generarConsecutivoAlfa() {
  await seedCounterFromExisting();
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const doc = await AlfaCounter.findOneAndUpdate(
    { _id: COUNTER_ID },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `ALFA-${año}-${mes}-${doc.seq}`;
}

function toStringOrNull(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback ?? null;
  return String(value).trim();
}

function parseDateFlexible(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback ?? null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const iso = normalizeDate(value);
  if (!iso) return fallback ?? null;
  const d = new Date(`${iso}T12:00:00.000-05:00`);
  return Number.isNaN(d.getTime()) ? fallback ?? null : d;
}

function parseNumberFlexible(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback ?? null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(String(value).replace(/[^\d.,-]/g, '').replace(/,/g, ''));
  return Number.isNaN(n) ? fallback ?? null : n;
}

export function buildAlfaCasoPayload(data = {}, base = {}) {
  return {
    consecutivo: base.consecutivo ?? null,
    siniestro: toStringOrNull(data.siniestro, base.siniestro ?? null),
    identificacion: toStringOrNull(data.identificacion, base.identificacion ?? null),
    asegurado: toStringOrNull(data.asegurado, base.asegurado ?? null),
    tomador: toStringOrNull(data.tomador, base.tomador ?? null),
    ajustador: toStringOrNull(data.ajustador, base.ajustador ?? null),
    numeroPoliza: toStringOrNull(data.numeroPoliza, base.numeroPoliza ?? null),
    direccionPredio: toStringOrNull(data.direccionPredio, base.direccionPredio ?? null),
    numeroCredito: toStringOrNull(data.numeroCredito, base.numeroCredito ?? null),
    informacionContacto: toStringOrNull(
      data.informacionContacto,
      base.informacionContacto ?? null
    ),
    correo: toStringOrNull(data.correo, base.correo ?? null),
    celular: toStringOrNull(data.celular, base.celular ?? null),
    canalRadicacion: toStringOrNull(data.canalRadicacion, base.canalRadicacion ?? null),
    ciudad: toStringOrNull(data.ciudad, base.ciudad ?? null),
    departamento: toStringOrNull(data.departamento, base.departamento ?? null),
    fechaSiniestro: parseDateFlexible(data.fechaSiniestro, base.fechaSiniestro ?? null),
    fechaInicioPoliza: parseDateFlexible(data.fechaInicioPoliza, base.fechaInicioPoliza ?? null),
    fechaFinPoliza: parseDateFlexible(data.fechaFinPoliza, base.fechaFinPoliza ?? null),
    valorAseguradoInmueble: parseNumberFlexible(
      data.valorAseguradoInmueble,
      base.valorAseguradoInmueble ?? null
    ),
    valorAseguradoContenidos: parseNumberFlexible(
      data.valorAseguradoContenidos,
      base.valorAseguradoContenidos ?? null
    ),
    cobertura: toStringOrNull(data.cobertura, base.cobertura ?? null),
    estadoPagoPrimas: toStringOrNull(data.estadoPagoPrimas, base.estadoPagoPrimas ?? null),
    valorReservaPreventivaPromedio: parseNumberFlexible(
      data.valorReservaPreventivaPromedio,
      base.valorReservaPreventivaPromedio ?? null
    ),
    valorComercialInmueble: parseNumberFlexible(
      data.valorComercialInmueble,
      base.valorComercialInmueble ?? null
    ),
    reserva: parseNumberFlexible(data.reserva, base.reserva ?? null),
    valorReclamado: parseNumberFlexible(data.valorReclamado, base.valorReclamado ?? null),
    valorLiquidado: parseNumberFlexible(data.valorLiquidado, base.valorLiquidado ?? null),
    /** Solo ARNALD (formulario/reporte); Excel/SharePoint no los alimentan. */
    fechaLlamada: parseDateFlexible(data.fechaLlamada, base.fechaLlamada ?? null),
    observacionLlamada:
      toStringOrNull(data.observacionLlamada, base.observacionLlamada ?? null) || '',
    fechaInspeccion: parseDateFlexible(data.fechaInspeccion, base.fechaInspeccion ?? null),
    fechaUltimoDocumento: parseDateFlexible(
      data.fechaUltimoDocumento,
      base.fechaUltimoDocumento ?? null
    ),
    fechaLiquidado: parseDateFlexible(data.fechaLiquidado, base.fechaLiquidado ?? null),
    fechaAceptacionLiquidacion: parseDateFlexible(
      data.fechaAceptacionLiquidacion,
      base.fechaAceptacionLiquidacion ?? null
    ),
    fechaEnvioAseguradora: parseDateFlexible(
      data.fechaEnvioAseguradora,
      base.fechaEnvioAseguradora ?? null
    ),
    estado: toStringOrNull(data.estado, base.estado ?? null),
  };
}

export function stripProtectedAlfaFields(obj = {}) {
  const out = { ...obj };
  for (const f of PROTECTED_ALFA_FIELDS) {
    delete out[f];
  }
  return out;
}

export function computeAlfaImportDiff(incomingPayload = {}, existing = {}, updatableFields = []) {
  const changes = {};
  const patch = {};
  const ignored = {};

  for (const field of updatableFields) {
    const incoming = incomingPayload[field];
    const current = existing[field];

    // Real → placeholder: no pisar
    if (
      field === 'numeroPoliza' &&
      !isPolicyPlaceholder(current) &&
      isPolicyPlaceholder(incoming)
    ) {
      if (!valuesEqualForDiff(incoming, current) && incoming != null && String(incoming).trim() !== '') {
        ignored[field] = {
          before: current ?? null,
          afterExcel: incoming,
          action: 'INCOMING_PLACEHOLDER_IGNORED',
        };
      }
      continue;
    }

    const merged = mergeAlfaImportValue(incoming, current, { field });
    if (!valuesEqualForDiff(merged, current)) {
      changes[field] = {
        before: current ?? null,
        after: merged,
      };
      patch[field] = merged;
    }
  }

  return {
    changes,
    patch,
    ignored,
    hasChanges: Object.keys(changes).length > 0,
  };
}

export async function createAlfaCasoFromImport(data = {}) {
  const payload = buildAlfaCasoPayload(data);
  if (!payload.identificacion) {
    const err = new Error('identificación es obligatoria');
    err.code = 'MISSING_IDENTIFICACION';
    throw err;
  }
  if (!payload.estado) payload.estado = 'PENDIENTE';
  payload.consecutivo = await generarConsecutivoAlfa();
  delete payload.archivos;
  delete payload.liquidador;
  delete payload.informeUnico;
  delete payload.createdBy;
  return SegurosAlfaCaso.create(payload);
}

export async function updateAlfaCasoFields(caseId, patch = {}) {
  const safe = stripProtectedAlfaFields(patch);
  return SegurosAlfaCaso.findByIdAndUpdate(caseId, { $set: safe }, { new: true });
}
