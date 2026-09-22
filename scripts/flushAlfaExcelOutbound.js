/**
 * Procesa la cola outbound Alfa hasta vaciar pendientes de estadoGestion
 * (o un máximo de ciclos).
 *
 *   node scripts/flushAlfaExcelOutbound.js
 *   node scripts/flushAlfaExcelOutbound.js --max-cycles=20
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { runAlfaExcelOutboundWorkerCycle } from '../workers/alfaExcelOutboundWorker.js';

const maxCycles = (() => {
  const arg = process.argv.find((a) => a.startsWith('--max-cycles='));
  const n = arg ? parseInt(arg.split('=')[1], 10) : 15;
  return Number.isFinite(n) && n > 0 ? n : 15;
})();

await mongoose.connect(process.env.MONGO_URI, {
  family: 4,
  serverSelectionTimeoutMS: 30000,
});

async function resumen() {
  const rows = await AlfaExcelOutboundUpdate.aggregate([
    { $group: { _id: '$status', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  const pendingGestion = await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
    $or: [
      { 'changes.estadoGestion': { $exists: true } },
      { consecutivo: { $exists: true } },
    ],
  });
  const recentFailed = await AlfaExcelOutboundUpdate.find({
    status: 'failed',
    updatedAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
  })
    .select('consecutivo lastErrorCode lastError status')
    .limit(15)
    .lean();
  return { byStatus: rows, pendingGestion, recentFailed };
}

console.log('Antes:', JSON.stringify(await resumen(), null, 2));

for (let i = 1; i <= maxCycles; i += 1) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({
    status: 'pending',
  });
  if (!pending) {
    console.log(`Sin pendientes en ciclo ${i}`);
    break;
  }
  const summary = await runAlfaExcelOutboundWorkerCycle({ batchSize: 30 });
  console.log(`Ciclo ${i}:`, JSON.stringify(summary));
  if (summary?.skippedOverlapping) {
    console.log('Overlapping — esperando 5s');
    await new Promise((r) => setTimeout(r, 5000));
  }
}

console.log('Después:', JSON.stringify(await resumen(), null, 2));
await mongoose.disconnect();
