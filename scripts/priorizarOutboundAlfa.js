/**
 * Prioriza outbound de identificaciones concretas y drena un rato.
 * node scripts/priorizarOutboundAlfa.js 1144158482
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { runAlfaExcelOutboundCycle } from '../services/alfaExcelOutboundService.js';

const ids = process.argv.slice(2).filter(Boolean);
if (!ids.length) {
  console.error('Uso: node scripts/priorizarOutboundAlfa.js <identificacion>...');
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const casos = await SegurosAlfaCaso.find({ identificacion: { $in: ids } })
  .select('_id consecutivo identificacion')
  .lean();
const caseIds = casos.map((c) => c._id);
console.log('casos', casos);

const bumped = await AlfaExcelOutboundUpdate.updateMany(
  { caseId: { $in: caseIds }, status: { $in: ['pending', 'failed', 'processing'] } },
  {
    $set: {
      status: 'pending',
      nextRetryAt: new Date(0),
      attempts: 0,
      lastError: null,
      lastErrorCode: null,
      priority: 100,
    },
  }
);
console.log('bumped', bumped);

let synced = 0;
for (let i = 0; i < 20; i += 1) {
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 3 });
  for (const r of summary?.results || []) {
    if (r?.outcome === 'synced') {
      synced += 1;
      console.log('synced', r);
    }
  }
  const left = await AlfaExcelOutboundUpdate.countDocuments({
    caseId: { $in: caseIds },
    status: { $in: ['pending', 'processing', 'failed'] },
  });
  console.log({ round: i + 1, left, synced });
  if (left === 0) break;
}

const pendingAll = await AlfaExcelOutboundUpdate.countDocuments({
  status: { $in: ['pending', 'processing'] },
});
console.log({ done: true, pendingAll });
await mongoose.disconnect();
