/**
 * Repara corrimiento de columnas y formatos en Excel Alfa:
 * reescribe TODAS las amarillas ARNALD por encabezado (fechas mm-dd-yy, moneda COP).
 *
 * node scripts/repairAlfaExcelYellowFormats.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { getOutboundWritableFields } from '../config/alfaExcelOwnershipMap.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { ALFA_EXCEL_DATE_FIELDS } from '../config/alfaExcelColumnMap.js';

const FIELDS = getOutboundWritableFields();

/** Solo casos con fechas o montos de control (no reescribir 1998 solo por estado). */
const FOCUS_FIELDS = [
  'reserva',
  'valorReclamado',
  'valorLiquidado',
  'liquidadoCoberturaTerremo',
  'deducibleTerremoto',
  'valorLiquidacionCoberturasAdicionales',
  'deducibleCoberturasAdicionales',
  'valorTotalPagar',
  'fechaInspeccion',
  'fechaUltimoDocumento',
  'fechaLiquidado',
  'fechaAceptacionLiquidacion',
  'fechaEnvioAseguradora',
  'estadoGestion',
  'estado',
  'observacionesGestion',
  'valorReservaPreventivaPromedio',
  'valorComercialInmueble',
];

await mongoose.connect(process.env.MONGO_URI);

// Cancelar cola masiva previa (solo estado) para no saturar.
const cancelled = await AlfaExcelOutboundUpdate.updateMany(
  { status: { $in: ['pending', 'processing', 'failed'] } },
  {
    $set: {
      status: 'cancelled',
      lastError: 'superseded_by_yellow_format_repair',
      lastErrorCode: 'SUPERSEDED',
      nextRetryAt: null,
    },
  }
);
console.log(JSON.stringify({ event: 'CANCELLED_OLD_QUEUE', n: cancelled.modifiedCount }));

const or = [
  { valorTotalPagar: { $gt: 0 } },
  { liquidadoCoberturaTerremo: { $gt: 0 } },
  { valorLiquidado: { $gt: 0 } },
  { fechaInspeccion: { $ne: null } },
  { fechaUltimoDocumento: { $ne: null } },
  { fechaLiquidado: { $ne: null } },
];
const casos = await SegurosAlfaCaso.find({ $or: or })
  .select(['_id', 'consecutivo', ...FOCUS_FIELDS].join(' '))
  .lean();

console.log(
  JSON.stringify({ event: 'REPAIR_TARGETS', fields: FOCUS_FIELDS.length, casos: casos.length })
);

let enqueued = 0;
for (const caso of casos) {
  const dummyBefore = { _id: caso._id };
  const afterDoc = { _id: caso._id, consecutivo: caso.consecutivo };
  let has = false;
  for (const field of FOCUS_FIELDS) {
    if (!FIELDS.includes(field)) continue;
    const v = caso[field];
    if (v == null || v === '') continue;
    if (ALFA_EXCEL_DATE_FIELDS.includes(field)) {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) continue;
      dummyBefore[field] = new Date(d.getTime() + 86400000);
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      dummyBefore[field] = v + 1;
    } else {
      dummyBefore[field] = `__diff_${field}`;
    }
    afterDoc[field] = v;
    has = true;
  }
  if (!has) continue;
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: dummyBefore,
    afterDoc,
  });
  if (out) enqueued += 1;
}

await AlfaExcelOutboundUpdate.updateMany(
  { status: 'processing' },
  { $set: { status: 'pending', nextRetryAt: new Date(), attempts: 0 } }
);

let rounds = 0;
let synced = 0;
let failedN = 0;
while (rounds < 300) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
  });
  if (pending === 0) break;
  rounds += 1;
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 3 });
  for (const r of summary?.results || []) {
    if (r?.outcome === 'synced') synced += 1;
    if (r?.outcome === 'failed' || r?.outcome === 'dead') failedN += 1;
  }
  console.log(JSON.stringify({ round: rounds, pendingBefore: pending, synced, failedN }));
}

console.log(JSON.stringify({ done: true, enqueued, rounds, synced, failedN }));
await mongoose.disconnect();
