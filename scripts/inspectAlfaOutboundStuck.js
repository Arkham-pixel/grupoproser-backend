/**
 * Inspecciona cola outbound Alfa en Mongo.
 *   node scripts/inspectAlfaOutboundStuck.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { getAlfaExcelOutboundQueueStats } from '../services/alfaExcelOutboundService.js';

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
});

const byStatus = await AlfaExcelOutboundUpdate.aggregate([
  { $group: { _id: '$status', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);
const queue = await getAlfaExcelOutboundQueueStats();
const sample = await AlfaExcelOutboundUpdate.find({
  status: { $in: ['pending', 'processing', 'failed'] },
})
  .sort({ updatedAt: 1 })
  .limit(20)
  .select('status consecutivo lastError lastErrorCode attempts updatedAt')
  .lean();

console.log(JSON.stringify({ byStatus, queue }, null, 2));
for (const r of sample) {
  console.log({
    status: r.status,
    consecutivo: r.consecutivo,
    attempts: r.attempts,
    code: r.lastErrorCode,
    err: String(r.lastError || '').slice(0, 120),
    updatedAt: r.updatedAt,
  });
}

await mongoose.disconnect();
