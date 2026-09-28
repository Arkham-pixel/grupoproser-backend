/**
 * Empuja a Excel montos de liquidación corregidos (Mongo → SharePoint).
 * node scripts/pushAlfaMontosCorregidosAExcel.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

const FIELDS = [
  'valorReclamado',
  'valorLiquidado',
  'liquidadoCoberturaTerremo',
  'deducibleTerremoto',
  'valorLiquidacionCoberturasAdicionales',
  'deducibleCoberturasAdicionales',
  'valorTotalPagar',
  'reserva',
];

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
  socketTimeoutMS: 120000,
});

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
if (!src?.itemId || isAlfaExcelFinalProtectedName(src.fileName)) {
  console.error('ABORT', src?.fileName);
  process.exit(1);
}
console.log('Excel:', src.fileName);

const casos = await SegurosAlfaCaso.find({
  excluidoBaseAlfa: { $ne: true },
  $or: [
    { valorLiquidado: { $gt: 0 } },
    { valorTotalPagar: { $gt: 0 } },
    { liquidadoCoberturaTerremo: { $gt: 0 } },
    { reserva: { $gt: 0 } },
  ],
})
  .select(['_id', 'consecutivo', 'identificacion', ...FIELDS].join(' '))
  .lean();

let enqueued = 0;
let skipped = 0;
for (const caso of casos) {
  const before = { _id: caso._id };
  const after = { _id: caso._id, consecutivo: caso.consecutivo };
  let has = false;
  for (const f of FIELDS) {
    const v = caso[f];
    if (v == null || v === '') continue;
    before[f] = typeof v === 'number' && Number.isFinite(v) ? v + 1 : `__diff_${f}`;
    after[f] = v;
    has = true;
  }
  if (!has) {
    skipped += 1;
    continue;
  }
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: before,
    afterDoc: after,
  });
  if (out) enqueued += 1;
  else skipped += 1;
}

console.log(JSON.stringify({ casos: casos.length, enqueued, skipped }));

await AlfaExcelOutboundUpdate.updateMany(
  { status: 'processing' },
  { $set: { status: 'pending', nextRetryAt: new Date() } }
);
await AlfaExcelOutboundUpdate.updateMany(
  {
    status: { $in: ['failed', 'dead'] },
    updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  },
  { $set: { status: 'pending', nextRetryAt: new Date(), attempts: 0 } }
);

let rounds = 0;
let synced = 0;
let failed = 0;
while (rounds < 200) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
  });
  if (pending === 0) break;
  rounds += 1;
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 6 });
  for (const r of summary?.results || []) {
    if (r?.outcome === 'synced') synced += 1;
    if (r?.outcome === 'failed' || r?.outcome === 'dead') failed += 1;
  }
  console.log(JSON.stringify({ round: rounds, pendingBefore: pending, synced, failed }));
}

const left = await AlfaExcelOutboundUpdate.countDocuments({
  status: { $in: ['pending', 'processing', 'failed'] },
});
console.log(JSON.stringify({ done: true, fileName: src.fileName, rounds, synced, failed, left }));
await mongoose.disconnect();
