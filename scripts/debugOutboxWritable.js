import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { assertFieldWritableOrThrow, getOutboundWritableFields } from '../config/alfaExcelOwnershipMap.js';

await mongoose.connect(process.env.MONGO_URI);
const docs = await AlfaExcelOutboundUpdate.find({
  consecutivo: { $in: ['ALFA-2026-08-12', 'ALFA-2026-08-8'] },
})
  .sort({ updatedAt: -1 })
  .limit(6)
  .lean();
for (const d of docs) {
  const changes = d.changes instanceof Map ? Object.fromEntries(d.changes) : d.changes || {};
  const keys = Object.keys(changes);
  const bad = [];
  for (const k of keys) {
    try {
      assertFieldWritableOrThrow(k);
    } catch (e) {
      bad.push(k);
    }
  }
  console.log(
    JSON.stringify({
      consecutivo: d.consecutivo,
      status: d.status,
      code: d.lastErrorCode,
      updatedAt: d.updatedAt,
      keys,
      bad,
      cols: d.sourceExcel?.columnsWritten || [],
    })
  );
}
console.log('writable', getOutboundWritableFields().length);
await mongoose.disconnect();
