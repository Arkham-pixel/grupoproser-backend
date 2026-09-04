/**
 * Reabre failed de control liquidación + drain-only.
 * node scripts/retryAlfaControlFailed.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';

const FIELDS = [
  'valorLiquidado',
  'liquidadoCoberturaTerremo',
  'deducibleTerremoto',
  'valorLiquidacionCoberturasAdicionales',
  'deducibleCoberturasAdicionales',
  'valorTotalPagar',
  'reserva',
];

const ONLY = process.argv[2] || null; // opcional: ALFA-2026-08-1458

await mongoose.connect(process.env.MONGO_URI);

const filtro = ONLY
  ? { consecutivo: ONLY }
  : {
      status: 'failed',
      lastErrorCode: {
        $in: ['ALFA_EXCEL_FIELD_NOT_WRITABLE', 'OUTBOUND_CELL_VERIFY_FAILED'],
      },
      $or: FIELDS.map((f) => ({ [`changes.${f}`]: { $exists: true } })),
    };

const failed = await AlfaExcelOutboundUpdate.find(filtro)
  .select('caseId consecutivo')
  .lean();

const caseIds = [...new Set(failed.map((f) => String(f.caseId)))];
console.log(JSON.stringify({ event: 'RETRY_TARGETS', n: caseIds.length, only: ONLY }));

let enqueued = 0;
for (const id of caseIds) {
  const caso = await SegurosAlfaCaso.findById(id)
    .select(['_id', 'consecutivo', ...FIELDS].join(' '))
    .lean();
  if (!caso) continue;
  const dummyBefore = { _id: caso._id };
  const afterDoc = { _id: caso._id, consecutivo: caso.consecutivo };
  let has = false;
  for (const field of FIELDS) {
    const v = caso[field];
    if (v == null || v === '') continue;
    dummyBefore[field] = typeof v === 'number' && Number.isFinite(v) ? v + 1 : `__diff_${field}`;
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
  { $set: { status: 'pending', nextRetryAt: new Date() } }
);
await AlfaExcelOutboundUpdate.updateMany(
  {
    status: 'pending',
    lastErrorCode: { $in: ['EXCEL_SOURCE_ETAG_CHANGED', null] },
  },
  { $set: { nextRetryAt: new Date(), attempts: 0 } }
);

let rounds = 0;
let synced = 0;
let failedN = 0;
while (rounds < 120) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
  });
  if (pending === 0) break;
  rounds += 1;
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 5 });
  for (const r of summary?.results || []) {
    if (r?.outcome === 'synced') synced += 1;
    if (r?.outcome === 'failed' || r?.outcome === 'dead') failedN += 1;
  }
  console.log(JSON.stringify({ round: rounds, pendingBefore: pending, synced, failedN }));
}

const check = ONLY
  ? await AlfaExcelOutboundUpdate.findOne({ consecutivo: ONLY })
      .sort({ updatedAt: -1 })
      .select('status lastErrorCode match sourceExcel.columnsWritten')
      .lean()
  : null;

console.log(JSON.stringify({ done: true, enqueued, rounds, synced, failedN, check }, null, 2));
await mongoose.disconnect();
