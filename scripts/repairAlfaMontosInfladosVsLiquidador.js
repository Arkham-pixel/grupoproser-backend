/**
 * VALOR LIQUIDADO / RECLAMADO inflados ×10 o ×100 vs el liquidador (centavos pegados).
 * Ejemplo: 7.597.812,12 → 759.781.212. No parte SID reales de cientos de millones.
 *
 * node scripts/repairAlfaMontosInfladosVsLiquidador.js
 * node scripts/repairAlfaMontosInfladosVsLiquidador.js --dry-run
 * node scripts/repairAlfaMontosInfladosVsLiquidador.js --no-drain
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import {
  aplicarMontosOficialesDesdeLiquidadorAlfa,
  liquidadorAlfaTieneCifras,
} from '../utils/valoresLiquidadorAlfa.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

const DRY = process.argv.includes('--dry-run');
const NO_DRAIN = process.argv.includes('--no-drain');

await mongoose.connect(process.env.MONGO_URI);

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
if (!DRY && (!src?.itemId || isAlfaExcelFinalProtectedName(src.fileName))) {
  console.error('ABORT source', src?.fileName, src?.itemId);
  await mongoose.disconnect();
  process.exit(1);
}
if (!DRY) console.log('writing to', src.fileName, NO_DRAIN ? '(no-drain)' : '');

const casos = await SegurosAlfaCaso.find({
  liquidador: { $exists: true, $ne: null, $type: 'object' },
  $or: [{ valorReclamado: { $gt: 0 } }, { valorLiquidado: { $gt: 0 } }],
})
  .select(
    '_id consecutivo identificacion valorReclamado valorLiquidado valorAseguradoSid liquidador'
  )
  .lean();

const samples = [];
let patched = 0;
let enqueued = 0;

for (const caso of casos) {
  if (!liquidadorAlfaTieneCifras(caso.liquidador)) continue;
  const sanado = aplicarMontosOficialesDesdeLiquidadorAlfa(caso);
  const patch = {};
  for (const f of ['valorReclamado', 'valorLiquidado']) {
    if (Number(caso[f]) === Number(sanado[f])) continue;
    if (sanado[f] == null) continue;
    patch[f] = sanado[f];
  }
  if (!Object.keys(patch).length) continue;

  patched += 1;
  if (samples.length < 20) {
    samples.push({
      consecutivo: caso.consecutivo,
      before: { valorReclamado: caso.valorReclamado, valorLiquidado: caso.valorLiquidado },
      after: {
        valorReclamado: patch.valorReclamado ?? caso.valorReclamado,
        valorLiquidado: patch.valorLiquidado ?? caso.valorLiquidado,
      },
    });
  }

  if (DRY) continue;

  await SegurosAlfaCaso.updateOne({ _id: caso._id }, { $set: patch });
  const afterDoc = { ...caso, ...patch };
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: caso,
    afterDoc,
  });
  if (out) enqueued += 1;
}

console.log(
  JSON.stringify(
    { dry: DRY, casos: casos.length, patched, enqueued, samples },
    null,
    2
  )
);

if (DRY || NO_DRAIN) {
  await mongoose.disconnect();
  process.exit(0);
}

await AlfaExcelOutboundUpdate.updateMany(
  { status: 'processing' },
  { $set: { status: 'pending', nextRetryAt: new Date() } }
);

let rounds = 0;
let synced = 0;
let failed = 0;
while (rounds < 80) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
  });
  if (pending === 0) break;
  rounds += 1;
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 10 });
  const results = summary?.results || [];
  for (const r of results) {
    if (r?.outcome === 'synced') synced += 1;
    if (r?.outcome === 'failed' || r?.outcome === 'dead') failed += 1;
  }
  console.log(JSON.stringify({ round: rounds, pendingBefore: pending, synced, failed }));
}

console.log(JSON.stringify({ done: true, fileName: src.fileName, rounds, synced, failed }));
await mongoose.disconnect();
