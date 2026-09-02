/**
 * Sanea valor reclamado / liquidado (centavos concatenados) y los escribe
 * en el consolidado operativo de Alfa (SharePoint).
 *
 * node scripts/pushAlfaMontosOficialesExcel.js
 * node scripts/pushAlfaMontosOficialesExcel.js --dry-run
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { pesosOficialesAlfa } from '../utils/alfaExcelNormalize.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

const DRY = process.argv.includes('--dry-run');
const MONEY_FIELDS = ['valorReclamado', 'valorLiquidado'];

await mongoose.connect(process.env.MONGO_URI);

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
if (!src?.itemId || isAlfaExcelFinalProtectedName(src.fileName)) {
  console.error('ABORT source', src?.fileName, src?.itemId);
  await mongoose.disconnect();
  process.exit(1);
}
console.log('writing to', src.fileName, DRY ? '(dry-run)' : '');

const casos = await SegurosAlfaCaso.find({
  $or: [
    { valorReclamado: { $ne: null } },
    { valorLiquidado: { $ne: null } },
  ],
})
  .select('_id consecutivo valorReclamado valorLiquidado')
  .lean();

let patched = 0;
let enqueued = 0;
let skipped = 0;
const samples = [];

for (const caso of casos) {
  const patch = {};
  const dummyBefore = { _id: caso._id };

  for (const field of MONEY_FIELDS) {
    const oficial = pesosOficialesAlfa(caso[field]);
    if (oficial == null) continue;
    dummyBefore[field] = oficial === 0 ? 1 : 0;
    if (Number(caso[field]) !== oficial) patch[field] = oficial;
  }

  if (!Object.keys(patch).length) {
    skipped += 1;
    continue;
  }

  if (samples.length < 8) {
    samples.push({
      consecutivo: caso.consecutivo,
      before: { valorReclamado: caso.valorReclamado, valorLiquidado: caso.valorLiquidado },
      after: {
        valorReclamado: patch.valorReclamado ?? caso.valorReclamado,
        valorLiquidado: patch.valorLiquidado ?? caso.valorLiquidado,
      },
    });
  }

  patched += 1;
  if (DRY) {
    enqueued += 1;
    continue;
  }

  await SegurosAlfaCaso.updateOne({ _id: caso._id }, { $set: patch });
  const afterDoc = { ...caso, ...patch };
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: dummyBefore,
    afterDoc,
  });
  if (out) enqueued += 1;
  else skipped += 1;
}

console.log(JSON.stringify({ casos: casos.length, patched, enqueued, skipped, samples }, null, 2));

if (DRY) {
  await mongoose.disconnect();
  process.exit(0);
}

await AlfaExcelOutboundUpdate.updateMany(
  { status: 'processing' },
  { $set: { status: 'pending', nextRetryAt: new Date() } }
);

let rounds = 0;
let synced = 0;
let failed = 0;
while (rounds < 120) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({
    status: 'pending',
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
  });
  if (pending === 0) break;
  rounds += 1;
  const t0 = Date.now();
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 10 });
  const results = summary?.results || [];
  for (const r of results) {
    if (r?.outcome === 'synced') synced += 1;
    if (r?.outcome === 'failed' || r?.outcome === 'dead') failed += 1;
  }
  console.log(
    JSON.stringify({
      round: rounds,
      pendingBefore: pending,
      processed: results.length,
      synced,
      failed,
      ms: Date.now() - t0,
    })
  );
}

const by = await AlfaExcelOutboundUpdate.aggregate([
  { $group: { _id: '$status', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);
const recentFailed = await AlfaExcelOutboundUpdate.find({
  status: { $in: ['failed', 'dead'] },
})
  .sort({ updatedAt: -1 })
  .limit(8)
  .select('consecutivo lastError lastErrorCode')
  .lean();

console.log(
  JSON.stringify(
    { done: true, fileName: src.fileName, rounds, synced, failed, by, recentFailed },
    null,
    2
  )
);

await mongoose.disconnect();
