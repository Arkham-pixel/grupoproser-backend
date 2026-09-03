/**
 * VALOR RECLAMADO = cédula (o cédula/100). El liquidador vacío no genera esos millones.
 * node scripts/repairAlfaReclamadoEsCedula.js
 * node scripts/repairAlfaReclamadoEsCedula.js --dry-run
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { pareceIdentificacionComoMontoAlfa, pesosOficialesAlfa } from '../utils/alfaExcelNormalize.js';
import {
  extraerMontosLiquidadorAlfa,
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
if (!DRY) console.log('writing to', src.fileName);

const casos = await SegurosAlfaCaso.find({
  $or: [{ valorReclamado: { $gt: 0 } }, { valorLiquidado: { $gt: 0 } }],
})
  .select(
    '_id consecutivo identificacion valorReclamado valorLiquidado liquidador'
  )
  .lean();

casos.sort((a, b) => {
  if (a.consecutivo === 'ALFA-2026-08-1450') return -1;
  if (b.consecutivo === 'ALFA-2026-08-1450') return 1;
  return 0;
});

const samples = [];
let patched = 0;
let enqueued = 0;

for (const caso of casos) {
  const patch = {};
  const excelAfter = { ...caso };
  for (const field of ['valorReclamado', 'valorLiquidado']) {
    if (!pareceIdentificacionComoMontoAlfa(caso[field], caso.identificacion)) continue;
    let next = 0;
    if (liquidadorAlfaTieneCifras(caso.liquidador)) {
      const montos = extraerMontosLiquidadorAlfa(caso.liquidador, caso);
      const cand = pesosOficialesAlfa(montos[field], caso.identificacion);
      if (cand != null && cand > 0 && !pareceIdentificacionComoMontoAlfa(cand, caso.identificacion)) {
        next = cand;
      }
    }
    patch[field] = next === 0 ? null : next;
    excelAfter[field] = next;
  }
  if (!Object.keys(patch).length) continue;
  patched += 1;
  if (samples.length < 8) {
    samples.push({
      consecutivo: caso.consecutivo,
      identificacion: caso.identificacion,
      before: { valorReclamado: caso.valorReclamado, valorLiquidado: caso.valorLiquidado },
      after: patch,
    });
  }
  if (DRY) continue;
  await SegurosAlfaCaso.updateOne({ _id: caso._id }, { $set: patch });
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: caso,
    afterDoc: excelAfter,
  });
  if (out) enqueued += 1;
}

console.log(
  JSON.stringify({ dry: DRY, scanned: casos.length, patched, enqueued, samples }, null, 2)
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
    status: 'pending',
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
