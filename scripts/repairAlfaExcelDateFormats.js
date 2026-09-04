/**
 * Reescribe fechas ARNALD → Excel con formato dd/mm/yyyy
 * y limpia texto basura en columnas de fecha.
 *
 * node scripts/repairAlfaExcelDateFormats.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { ALFA_EXCEL_DATE_FIELDS } from '../config/alfaExcelColumnMap.js';

const DATE_FIELDS = ALFA_EXCEL_DATE_FIELDS.filter((f) =>
  [
    'fechaInspeccion',
    'fechaUltimoDocumento',
    'fechaLiquidado',
    'fechaAceptacionLiquidacion',
    'fechaEnvioAseguradora',
  ].includes(f)
);

await mongoose.connect(process.env.MONGO_URI);

const or = DATE_FIELDS.map((f) => ({ [f]: { $ne: null } }));
const casos = await SegurosAlfaCaso.find({ $or: or })
  .select(['_id', 'consecutivo', ...DATE_FIELDS, 'estado', 'estadoGestion'].join(' '))
  .lean();

console.log(JSON.stringify({ event: 'DATE_REPAIR_TARGETS', casos: casos.length, fmt: 'dd/mm/yyyy' }));

let enqueued = 0;
for (const caso of casos) {
  const dummyBefore = { _id: caso._id };
  const afterDoc = { _id: caso._id, consecutivo: caso.consecutivo };
  let has = false;
  for (const field of DATE_FIELDS) {
    const v = caso[field];
    if (v == null || v === '') continue;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) continue;
    dummyBefore[field] = new Date(d.getTime() + 86400000);
    afterDoc[field] = v;
    has = true;
  }
  // Reescribir estado a AI/AJ para no dejar basura en fechas
  if (caso.estado != null && caso.estado !== '') {
    dummyBefore.estado = `__diff_${caso.estado}`;
    afterDoc.estado = caso.estado;
    has = true;
  }
  if (caso.estadoGestion != null && caso.estadoGestion !== '') {
    dummyBefore.estadoGestion = `__diff_${caso.estadoGestion}`;
    afterDoc.estadoGestion = caso.estadoGestion;
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
await AlfaExcelOutboundUpdate.updateMany(
  { status: 'pending' },
  { $set: { nextRetryAt: new Date() } }
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
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 4 });
  for (const r of summary?.results || []) {
    if (r?.outcome === 'synced') synced += 1;
    if (r?.outcome === 'failed' || r?.outcome === 'dead') failedN += 1;
  }
  console.log(JSON.stringify({ round: rounds, pendingBefore: pending, synced, failedN }));
}

console.log(JSON.stringify({ done: true, enqueued, rounds, synced, failedN, fmt: 'dd/mm/yyyy' }));
await mongoose.disconnect();
