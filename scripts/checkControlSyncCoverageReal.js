/**
 * Coverage real: ¿alguna vez se escribieron Y–AC? (no solo el último outbox).
 * node scripts/checkControlSyncCoverageReal.js
 */
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
const out = await AlfaExcelOutboundUpdate.find({
  caseId: { $in: ids },
  status: 'synced',
})
  .select('caseId sourceExcel.columnsWritten syncedAt updatedAt')
  .lean();

const best = new Map();
for (const o of out) {
  const cols = new Set(o.sourceExcel?.columnsWritten || []);
  const n = ['Y', 'Z', 'AA', 'AB', 'AC'].filter((c) => cols.has(c)).length;
  const k = String(o.caseId);
  const prev = best.get(k);
  if (!prev || n > prev.n) best.set(k, { n, cols: [...cols] });
}

let ok = 0;
const gaps = [];
for (const c of casos) {
  const b = best.get(String(c._id));
  if (b && b.n >= 3) ok += 1;
  else gaps.push({ consecutivo: c.consecutivo, bestN: b?.n || 0, cols: b?.cols || [] });
}

const pending = await AlfaExcelOutboundUpdate.countDocuments({
  status: { $in: ['pending', 'processing'] },
});

console.log(
  JSON.stringify(
    {
      conMontos: casos.length,
      everSyncedControl: ok,
      neverSyncedControl: gaps.length,
      colaPending: pending,
      sampleGaps: gaps.slice(0, 20),
    },
    null,
    2
  )
);
await mongoose.disconnect();
