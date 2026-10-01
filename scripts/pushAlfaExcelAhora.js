/**
 * Actualiza Excel Control y Seguimiento desde ARNALD ahora:
 * 1) libera processing stuck
 * 2) encola diferencias amarillas (tipificados/montos)
 * 3) flush hasta vaciar cola
 *
 *   node scripts/pushAlfaExcelAhora.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import {
  forceEnqueueAlfaExcelOutboundCases,
  flushAlfaExcelOutboundManual,
  getAlfaExcelOutboundQueueStats,
} from '../services/alfaExcelOutboundService.js';

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
});

console.log('Cola antes:', await getAlfaExcelOutboundQueueStats());

const released = await AlfaExcelOutboundUpdate.updateMany(
  { status: 'processing' },
  {
    $set: {
      status: 'pending',
      nextRetryAt: new Date(),
      lastError: null,
      lastErrorCode: null,
    },
  }
);
console.log('Liberados processing→pending:', released.modifiedCount || 0);

const failedReset = await AlfaExcelOutboundUpdate.updateMany(
  { status: 'failed' },
  {
    $set: {
      status: 'pending',
      attempts: 0,
      nextRetryAt: new Date(),
      lastError: null,
      lastErrorCode: null,
    },
  }
);
console.log('Reencolados failed→pending:', failedReset.modifiedCount || 0);

console.log('Comparando ARNALD vs Excel (amarillas)…');
const enq = await forceEnqueueAlfaExcelOutboundCases({
  onlyWithMoney: true,
  limit: 250,
  diffAgainstExcel: true,
});
console.log('Enqueue:', enq);

let queue = await getAlfaExcelOutboundQueueStats();
console.log('Cola tras enqueue:', queue);

let round = 0;
while (queue.total > 0 && round < 30) {
  round += 1;
  const flush = await flushAlfaExcelOutboundManual({ maxRounds: 3, batchSize: 15 });
  queue = await getAlfaExcelOutboundQueueStats();
  console.log(`Flush round ${round}:`, { flush, queue });
  if (!(flush.claimed > 0) && queue.processing === 0) {
    // nada claimed: liberar processing residual y reintentar una vez
    await AlfaExcelOutboundUpdate.updateMany(
      { status: 'processing' },
      { $set: { status: 'pending', nextRetryAt: new Date() } }
    );
    queue = await getAlfaExcelOutboundQueueStats();
    if (!(queue.pending > 0)) break;
  }
}

console.log('Cola final:', await getAlfaExcelOutboundQueueStats());
await mongoose.disconnect();
