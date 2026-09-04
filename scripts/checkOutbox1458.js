import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';

await mongoose.connect(process.env.MONGO_URI);
const c1458 = await AlfaExcelOutboundUpdate.findOne({ consecutivo: 'ALFA-2026-08-1458' })
  .sort({ updatedAt: -1 })
  .select('status lastErrorCode match updatedAt sourceExcel.columnsWritten')
  .lean();
const by = await AlfaExcelOutboundUpdate.aggregate([
  { $group: { _id: '$status', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);
const pending = await AlfaExcelOutboundUpdate.find({
  status: { $in: ['pending', 'processing'] },
})
  .select('consecutivo lastErrorCode nextRetryAt')
  .sort({ updatedAt: -1 })
  .limit(25)
  .lean();
console.log(JSON.stringify({ c1458, by, pending }, null, 2));
await mongoose.disconnect();
