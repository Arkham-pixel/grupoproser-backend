/**
 * Repara casos AIU 0% cuyo flat quedó ×1.2 (AIU fantasma) y empuja Excel.
 * node scripts/repairAlfaAiuFantasmaX12.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import {
  aplicarMontosOficialesDesdeLiquidadorAlfa,
  extraerMontosLiquidadorAlfa,
  liquidadorAlfaTieneCifras,
} from '../utils/valoresLiquidadorAlfa.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

const CAMPOS = [
  'valorReclamado',
  'valorLiquidado',
  'liquidadoCoberturaTerremo',
  'deducibleTerremoto',
  'valorLiquidacionCoberturasAdicionales',
  'deducibleCoberturasAdicionales',
  'valorTotalPagar',
  'reserva',
];

function moneyEq(a, b) {
  return Math.round(Number(a) || 0) === Math.round(Number(b) || 0);
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
if (!src?.itemId || isAlfaExcelFinalProtectedName(src.fileName)) {
  console.error('ABORT', src?.fileName);
  process.exit(1);
}

const casos = await SegurosAlfaCaso.find({
  excluidoBaseAlfa: { $ne: true },
  liquidador: { $exists: true, $type: 'object' },
})
  .select(['_id', 'consecutivo', 'identificacion', 'liquidador', ...CAMPOS].join(' '))
  .lean();

let patched = 0;
let enqueued = 0;
const samples = [];

for (const caso of casos) {
  if (!liquidadorAlfaTieneCifras(caso.liquidador)) continue;
  const montos = extraerMontosLiquidadorAlfa(caso.liquidador, caso);
  const sanado = aplicarMontosOficialesDesdeLiquidadorAlfa(caso);
  if (sanado.valorLiquidado != null) sanado.reserva = sanado.valorLiquidado;

  const patch = {};
  for (const f of CAMPOS) {
    if (sanado[f] == null) continue;
    if (moneyEq(caso[f], sanado[f])) continue;
    patch[f] = Math.round(Number(sanado[f]) || 0);
  }
  if (!Object.keys(patch).length) continue;

  patched += 1;
  samples.push({
    consecutivo: caso.consecutivo,
    identificacion: caso.identificacion,
    aiuPct: montos.aiuPct,
    before: Object.fromEntries(CAMPOS.map((f) => [f, caso[f]])),
    after: Object.fromEntries(CAMPOS.map((f) => [f, patch[f] ?? caso[f]])),
    campos: Object.keys(patch),
  });

  await SegurosAlfaCaso.updateOne(
    { _id: caso._id },
    { $set: { ...patch, updatedAt: new Date() } }
  );

  const beforeDoc = { ...caso };
  for (const f of Object.keys(patch)) {
    beforeDoc[f] = Number(patch[f]) === 0 ? 1 : Number(patch[f]) + 1;
  }
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc,
    afterDoc: { ...caso, ...patch },
  });
  if (out) enqueued += 1;
}

console.log(
  JSON.stringify(
    {
      scanned: casos.length,
      patched,
      enqueued,
      sample790: samples.find((s) => s.consecutivo === 'ALFA-2026-08-790') || null,
      samples: samples.slice(0, 25),
    },
    null,
    2
  )
);

await AlfaExcelOutboundUpdate.updateMany(
  { status: { $in: ['processing', 'failed'] } },
  { $set: { status: 'pending', nextRetryAt: new Date(), attempts: 0 } }
);

let rounds = 0;
let synced = 0;
let failed = 0;
while (rounds < 60) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
  });
  if (!pending) break;
  rounds += 1;
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 5 });
  for (const r of summary?.results || []) {
    if (r?.outcome === 'synced') synced += 1;
    if (r?.outcome === 'failed' || r?.outcome === 'dead') failed += 1;
  }
  console.log(JSON.stringify({ round: rounds, pendingBefore: pending, synced, failed }));
}

console.log(
  JSON.stringify({
    done: true,
    fileName: src.fileName,
    rounds,
    synced,
    failed,
    left: await AlfaExcelOutboundUpdate.countDocuments({
      status: { $in: ['pending', 'processing', 'failed'] },
    }),
  })
);

await mongoose.disconnect();
