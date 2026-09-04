import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';

await mongoose.connect(process.env.MONGO_URI);
const casos = await SegurosAlfaCaso.find({
  $or: [
    { valorTotalPagar: { $gt: 0 } },
    { liquidadoCoberturaTerremo: { $gt: 0 } },
    { valorLiquidado: { $gt: 0 } },
  ],
})
  .select('_id consecutivo')
  .lean();
const ids = casos.map((c) => c._id);
const out = await AlfaExcelOutboundUpdate.find({ caseId: { $in: ids } })
  .sort({ updatedAt: -1 })
  .select('caseId consecutivo status lastErrorCode sourceExcel.columnsWritten nextRetryAt')
  .lean();
const latest = new Map();
for (const o of out) {
  const k = String(o.caseId);
  if (!latest.has(k)) latest.set(k, o);
}
let synced = 0;
const gaps = [];
for (const c of casos) {
  const o = latest.get(String(c._id));
  const cols = new Set(o?.sourceExcel?.columnsWritten || []);
  const ok =
    o?.status === 'synced' &&
    ['Y', 'Z', 'AA', 'AB', 'AC'].filter((x) => cols.has(x)).length >= 3;
  if (ok) synced += 1;
  else
    gaps.push({
      consecutivo: c.consecutivo,
      status: o?.status || 'sin_outbox',
      code: o?.lastErrorCode || null,
      cols: [...cols],
    });
}
const byStatus = {};
for (const g of gaps) byStatus[g.status] = (byStatus[g.status] || 0) + 1;
const pending = await AlfaExcelOutboundUpdate.countDocuments({
  status: { $in: ['pending', 'processing'] },
});
console.log(
  JSON.stringify(
    {
      conMontos: casos.length,
      controlSynced: synced,
      gaps: gaps.length,
      gapsByStatus: byStatus,
      colaPending: pending,
      sampleGaps: gaps.slice(0, 15),
    },
    null,
    2
  )
);
await mongoose.disconnect();
