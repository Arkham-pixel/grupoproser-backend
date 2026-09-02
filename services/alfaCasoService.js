/**
 * Lógica compartida de casos Seguros Alfa (creación / consecutivo / payload).
 */

import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { PROTECTED_ALFA_FIELDS } from '../config/alfaExcelColumnMap.js';
import {
  valuesEqualForDiff,
  normalizeDate,
  decideAlfaExcelMerge,
  normalizeMoney,
  pesosOficialesAlfa,
} from '../utils/alfaExcelNormalize.js';
import { isArnaldOwnedField } from '../config/alfaExcelOwnershipMap.js';
import {
  estadoGestionDesdeEstadoAlfa,
  homologarEstadoAlfa,
} from '../config/alfaExcelStatuses.js';

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
  if (typeof value === 'number' && Number.isFinite(value)) {
    return pesosOficialesAlfa(value) ?? value;
  }
  const n = normalizeMoney(value);
  if (n == null) return fallback ?? null;
  return pesosOficialesAlfa(n);
}

export function buildAlfaCasoPayload(data = {}, base = {}) {
  const out = {
    consecutivo: base.consecutivo ?? null,
    siniestro: toStringOrNull(data.siniestro, base.siniestro ?? null),
    identificacion: toStringOrNull(data.identificacion, base.identificacion ?? null),
    asegurado: toStringOrNull(data.asegurado, base.asegurado ?? null),
    tomador: toStringOrNull(data.tomador, base.tomador ?? null),
    ajustadorLider: toStringOrNull(data.ajustadorLider, base.ajustadorLider ?? null),
    ajustador: toStringOrNull(data.ajustador, base.ajustador ?? null),
    inspector: toStringOrNull(data.inspector, base.inspector ?? null),
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
    fechaAviso: parseDateFlexible(data.fechaAviso, base.fechaAviso ?? null),
    fechaInicioPoliza: parseDateFlexible(data.fechaInicioPoliza, base.fechaInicioPoliza ?? null),
    fechaFinPoliza: parseDateFlexible(data.fechaFinPoliza, base.fechaFinPoliza ?? null),
    valorAseguradoSid: parseNumberFlexible(
      data.valorAseguradoSid,
      base.valorAseguradoSid ?? null
    ),
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
    estadoGestion: toStringOrNull(data.estadoGestion, base.estadoGestion ?? null),
    observacionesGestion:
      toStringOrNull(data.observacionesGestion, base.observacionesGestion ?? null) || '',
    noAceptacionOferta:
      data.noAceptacionOferta != null
        ? Boolean(data.noAceptacionOferta)
        : base.noAceptacionOferta != null
          ? Boolean(base.noAceptacionOferta)
          : false,
    zonaAsignada: toStringOrNull(data.zonaAsignada, base.zonaAsignada ?? null) || '',
    fueraDeZona:
      data.fueraDeZona != null
        ? Boolean(data.fueraDeZona)
        : base.fueraDeZona != null
          ? Boolean(base.fueraDeZona)
          : false,
    casoPadreId: data.casoPadreId ?? base.casoPadreId ?? null,
    grupoReclamacion: toStringOrNull(data.grupoReclamacion, base.grupoReclamacion ?? null) || '',
    fechaComunicacionBajoDeducible: parseDateFlexible(
      data.fechaComunicacionBajoDeducible,
      base.fechaComunicacionBajoDeducible ?? null
    ),
  };

  // Un solo eje: homologar estado y sincronizar estadoGestion (Excel AD).
  out.estado = homologarEstadoAlfa(out.estado, {
    fechaInspeccion: out.fechaInspeccion,
    estadoGestion: out.estadoGestion || data.estadoGestion || base.estadoGestion,
  });
  out.estadoGestion = estadoGestionDesdeEstadoAlfa(out.estado);
  return out;
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
    const decided = decideAlfaExcelMerge(incoming, current, {
      field,
      arnaldOwned: isArnaldOwnedField(field),
    });

    if (
      decided.action === 'KEEP_ARNALD_OWNED' ||
      decided.action === 'INCOMING_PLACEHOLDER_IGNORED'
    ) {
      ignored[field] = {
        before: current ?? null,
        afterExcel: incoming ?? null,
        action: decided.action,
      };
      continue;
    }

    if (
      decided.action === 'KEEP_ARNALD_EXCEL_EMPTY' ||
      decided.action === 'BOTH_EMPTY' ||
      decided.action === 'UNCHANGED' ||
      decided.action === 'KEEP_ARNALD_EXCEL_WEAKER_NAME'
    ) {
      continue;
    }

    const merged = decided.value;
    if (!valuesEqualForDiff(merged, current, field)) {
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
  if (!payload.estado) payload.estado = 'Sin contactar';
  payload.estado = homologarEstadoAlfa(payload.estado, payload);
  payload.estadoGestion = estadoGestionDesdeEstadoAlfa(payload.estado);
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

/**
 * ¿El array de ítems tiene al menos uno con texto (actividad/concepto/descripción)?
 * Evita mandar el liquidador completo al listado.
 */
function alfaArrayTieneItemConTexto(arrayExpr) {
  return {
    $gt: [
      {
        $size: {
          $filter: {
            input: { $cond: [{ $isArray: arrayExpr }, arrayExpr, []] },
            as: 'it',
            cond: {
              $gt: [
                {
                  $strLenCP: {
                    $trim: {
                      input: {
                        $concat: [
                          {
                            $convert: {
                              input: '$$it.actividad',
                              to: 'string',
                              onError: '',
                              onNull: '',
                            },
                          },
                          {
                            $convert: {
                              input: '$$it.concepto',
                              to: 'string',
                              onError: '',
                              onNull: '',
                            },
                          },
                          {
                            $convert: {
                              input: '$$it.descripcion',
                              to: 'string',
                              onError: '',
                              onNull: '',
                            },
                          },
                          {
                            $convert: {
                              input: '$$it.componente',
                              to: 'string',
                              onError: '',
                              onNull: '',
                            },
                          },
                        ],
                      },
                    },
                  },
                },
                0,
              ],
            },
          },
        },
      },
      0,
    ],
  };
}

/**
 * Pipeline del listado: metadatos + banderas, sin liquidador/informe (pueden ir
 * firmas/fotos en base64 y inflar 1550 casos a decenas de MB).
 */
export function buildAlfaListadoPipeline({ filtro = {}, skip = 0, limit = 25 } = {}) {
  return [
    { $match: filtro && Object.keys(filtro).length ? filtro : {} },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $addFields: {
        tieneLiquidador: { $eq: [{ $type: '$liquidador' }, 'object'] },
        tieneInforme: { $eq: [{ $type: '$informeUnico' }, 'object'] },
        tieneLiquidadorConContenido: {
          $or: [
            alfaArrayTieneItemConTexto('$liquidador.evaluacionSismicaNSR10.presupuesto.items'),
            alfaArrayTieneItemConTexto('$liquidador.detalleLiquidacionCat'),
          ],
        },
      },
    },
    {
      $project: {
        liquidador: 0,
        informeUnico: 0,
      },
    },
  ];
}
