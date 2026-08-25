/**
 * Drena cola outbound pendiente → consolidado operativo.
 * node scripts/drainAlfaExcelOutbound.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { runAlfaExcelOutboundCycle } from '../services/alfaExcelOutboundService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

await mongoose.connect(process.env.MONGO_URI);

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
if (!src?.itemId || isAlfaExcelFinalProtectedName(src.fileName)) {
  console.error('ABORT source', src?.fileName, src?.itemId);
  process.exit(1);
}
console.log('writing to', src.fileName);

// Liberar stuck processing
await AlfaExcelOutboundUpdate.updateMany(
  { status: 'processing' },
  { $set: { status: 'pending', nextRetryAt: new Date() } }
);

let rounds = 0;
while (rounds < 120) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({
    status: 'pending',
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
  });
  if (pending === 0) break;
  rounds += 1;
  const t0 = Date.now();
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 25 });
  const results = summary?.results || [];
  let ok = 0;
  let fail = 0;
  for (const r of results) {
    if (r?.outcome === 'synced') ok += 1;
    else fail += 1;
  }
  console.log(
    JSON.stringify({
      round: rounds,
      pendingBefore: pending,
      processed: results.length,
      synced: ok,
      other: fail,
      ms: Date.now() - t0,
    })
  );
}

const by = await AlfaExcelOutboundUpdate.aggregate([
  { $group: { _id: '$status', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);
console.log(JSON.stringify({ done: true, fileName: src.fileName, rounds, by }, null, 2));
await mongoose.disconnect();
