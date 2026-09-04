import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';

const IDS = [
  'ALFA-2026-08-72',
  'ALFA-2026-08-121',
  'ALFA-2026-08-220',
  'ALFA-2026-08-320',
  'ALFA-2026-08-331',
  'ALFA-2026-08-784',
  'ALFA-2026-08-1184',
  'ALFA-2026-08-1327',
  'ALFA-2026-08-1977',
];
const FIELDS = [
  'valorLiquidado',
  'liquidadoCoberturaTerremo',
  'deducibleTerremoto',
  'valorLiquidacionCoberturasAdicionales',
  'deducibleCoberturasAdicionales',
  'valorTotalPagar',
  'reserva',
];

await mongoose.connect(process.env.MONGO_URI);
const casos = await SegurosAlfaCaso.find({ consecutivo: { $in: IDS } })
  .select(['_id', 'consecutivo', ...FIELDS].join(' '))
  .lean();

for (const caso of casos) {
  const dummyBefore = { _id: caso._id };
  const afterDoc = { _id: caso._id, consecutivo: caso.consecutivo };
  for (const f of FIELDS) {
    const v = caso[f];
    if (v == null || v === '') continue;
    dummyBefore[f] = typeof v === 'number' ? v + 1 : '__x';
    afterDoc[f] = v;
  }
  await enqueueAlfaExcelOutboundFromCaseUpdate({ beforeDoc: dummyBefore, afterDoc });
}

await AlfaExcelOutboundUpdate.updateMany(
  { status: 'processing' },
  { $set: { status: 'pending', nextRetryAt: new Date() } }
);

let synced = 0;
let failed = 0;
let rounds = 0;
while (rounds < 40) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
  });
  if (!pending) break;
  rounds += 1;
  const s = await runAlfaExcelOutboundCycle({ batchSize: 3 });
  for (const r of s?.results || []) {
    if (r?.outcome === 'synced') synced += 1;
    if (r?.outcome === 'failed') failed += 1;
  }
  console.log(JSON.stringify({ rounds, pending, synced, failed }));
}

console.log(JSON.stringify({ done: true, casos: casos.length, synced, failed }));
await mongoose.disconnect();
