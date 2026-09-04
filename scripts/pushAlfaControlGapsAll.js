/**
 * Empuja a SharePoint TODOS los casos con control de liquidación en Mongo
 * cuyo outbox no esté synced (o no tenga Y–AC escritos).
 *
 * node scripts/pushAlfaControlGapsAll.js
 * node scripts/pushAlfaControlGapsAll.js --ids=66926240,67022547
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';

const FIELDS = [
  'valorLiquidado',
  'liquidadoCoberturaTerremo',
  'deducibleTerremoto',
  'valorLiquidacionCoberturasAdicionales',
  'deducibleCoberturasAdicionales',
  'valorTotalPagar',
  'reserva',
];

const idsArg = process.argv.find((a) => a.startsWith('--ids='));
const ONLY_IDS = idsArg
  ? idsArg
      .slice(6)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

await mongoose.connect(process.env.MONGO_URI);

const filtro = ONLY_IDS
  ? { identificacion: { $in: ONLY_IDS } }
  : {
      $or: [
        { valorTotalPagar: { $gt: 0 } },
        { liquidadoCoberturaTerremo: { $gt: 0 } },
        { valorLiquidado: { $gt: 0 } },
      ],
    };

const casos = await SegurosAlfaCaso.find(filtro)
  .select(['_id', 'consecutivo', 'identificacion', ...FIELDS].join(' '))
  .lean();

const caseIds = casos.map((c) => c._id);
const outbox = await AlfaExcelOutboundUpdate.find({ caseId: { $in: caseIds } })
  .sort({ updatedAt: -1 })
  .select('caseId status sourceExcel.columnsWritten')
  .lean();
const latest = new Map();
for (const o of outbox) {
  const k = String(o.caseId);
  if (!latest.has(k)) latest.set(k, o);
}

const need = [];
for (const c of casos) {
  const o = latest.get(String(c._id));
  const cols = new Set(o?.sourceExcel?.columnsWritten || []);
  const controlCols = ['Y', 'Z', 'AA', 'AB', 'AC', 'V', 'X'];
  const hasControlWritten =
    o?.status === 'synced' && controlCols.filter((col) => cols.has(col)).length >= 5;
  if (hasControlWritten) continue;
  need.push(c);
}

console.log(
  JSON.stringify({
    event: 'TARGETS',
    totalConMontos: casos.length,
    needPush: need.length,
    sample: need.slice(0, 8).map((c) => c.consecutivo),
  })
);

let enqueued = 0;
for (const caso of need) {
  const dummyBefore = { _id: caso._id };
  const afterDoc = { _id: caso._id, consecutivo: caso.consecutivo };
  let has = false;
  for (const field of FIELDS) {
    const v = caso[field];
    if (v == null || v === '') continue;
    // Incluir 0 explícito (deducible adicionales)
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    dummyBefore[field] =
      typeof v === 'number' && Number.isFinite(v) ? v + 1 : `__diff_${field}`;
    afterDoc[field] = v;
    has = true;
  }
  if (!has) continue;
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: dummyBefore,
    afterDoc,
  });
  if (out) enqueued += 1;
}

await AlfaExcelOutboundUpdate.updateMany(
  { status: 'processing' },
  { $set: { status: 'pending', nextRetryAt: new Date(), attempts: 0 } }
);
await AlfaExcelOutboundUpdate.updateMany(
  { status: 'pending' },
  { $set: { nextRetryAt: new Date() } }
);

let rounds = 0;
let synced = 0;
let failedN = 0;
while (rounds < 250) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
  });
  if (pending === 0) break;
  rounds += 1;
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 4 });
  for (const r of summary?.results || []) {
    if (r?.outcome === 'synced') synced += 1;
    if (r?.outcome === 'failed' || r?.outcome === 'dead') failedN += 1;
  }
  if (rounds % 1 === 0) {
    console.log(JSON.stringify({ round: rounds, pendingBefore: pending, synced, failedN }));
  }
}

console.log(JSON.stringify({ done: true, enqueued, rounds, synced, failedN }));
await mongoose.disconnect();
