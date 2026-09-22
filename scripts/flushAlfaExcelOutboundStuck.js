/**
 * Libera outbound stuck en processing y procesa pendientes (estadoGestion).
 *   node scripts/flushAlfaExcelOutboundStuck.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { runAlfaExcelOutboundWorkerCycle } from '../workers/alfaExcelOutboundWorker.js';

await mongoose.connect(process.env.MONGO_URI, {
  family: 4,
  serverSelectionTimeoutMS: 30000,
});

const stuckCut = new Date(Date.now() - 2 * 60 * 1000);
const released = await AlfaExcelOutboundUpdate.updateMany(
  {
    status: 'processing',
    $or: [{ lastAttemptAt: { $lte: stuckCut } }, { lastAttemptAt: null }],
  },
  {
    $set: {
      status: 'pending',
      nextRetryAt: new Date(),
      lastError: null,
      lastErrorCode: null,
    },
  }
);
console.log('Liberados processing→pending:', released.modifiedCount || released.nModified || 0);

const pendingGestion = await AlfaExcelOutboundUpdate.find({
  status: 'pending',
  'changes.estadoGestion': { $exists: true },
})
  .select('consecutivo changes.estadoGestion status')
  .lean();
console.log(
  'Pendientes estadoGestion:',
  pendingGestion.length,
  pendingGestion.slice(0, 10).map((p) => ({
    c: p.consecutivo,
    after: p.changes?.estadoGestion?.after,
  }))
);

for (let i = 1; i <= 25; i += 1) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({ status: 'pending' });
  if (!pending) {
    console.log(`Sin pendientes en ciclo ${i}`);
    break;
  }
  const summary = await runAlfaExcelOutboundWorkerCycle({ batchSize: 20 });
  console.log(
    `Ciclo ${i}: claimed=${summary.claimed} synced=${summary.synced} failed=${summary.failed}`
  );
  if (summary?.skippedOverlapping) {
    await new Promise((r) => setTimeout(r, 4000));
  }
}

const left = await AlfaExcelOutboundUpdate.aggregate([
  { $match: { status: { $in: ['pending', 'processing', 'failed'] } } },
  { $group: { _id: '$status', n: { $sum: 1 } } },
]);
const leftGestion = await AlfaExcelOutboundUpdate.countDocuments({
  status: { $in: ['pending', 'processing'] },
  'changes.estadoGestion': { $exists: true },
});
console.log('Restante:', JSON.stringify({ left, leftGestion }));
await mongoose.disconnect();
