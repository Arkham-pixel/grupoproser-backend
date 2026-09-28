/**
 * Resincroniza montos Alfa desde liquidador (corrige AIU 0% tratado como 20%, etc.).
 *
 * node scripts/repairAlfaMontosDesdeLiquidador.js --dry-run
 * node scripts/repairAlfaMontosDesdeLiquidador.js
 * node scripts/repairAlfaMontosDesdeLiquidador.js --no-drain
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

function sameMonto(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);

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
  excluidoBaseAlfa: { $ne: true },
  liquidador: { $exists: true, $ne: null, $type: 'object' },
})
  .select(
    [
      '_id',
      'consecutivo',
      'identificacion',
      'valorAseguradoSid',
      'liquidador',
      ...CAMPOS,
    ].join(' ')
  )
  .lean();

const samples = [];
let patched = 0;
let enqueued = 0;
let casoClave = null;

for (const caso of casos) {
  if (!liquidadorAlfaTieneCifras(caso.liquidador)) continue;
  const sanado = aplicarMontosOficialesDesdeLiquidadorAlfa(caso);
  // reserva sigue al total a indemnizar cuando el liquidador manda
  if (sanado.valorLiquidado != null) {
    sanado.reserva = sanado.valorLiquidado;
  }
  const patch = {};
  for (const f of CAMPOS) {
    if (sameMonto(caso[f], sanado[f])) continue;
    if (sanado[f] == null) continue;
    patch[f] = sanado[f];
  }
  if (!Object.keys(patch).length) continue;

  patched += 1;
  const row = {
    consecutivo: caso.consecutivo,
    identificacion: caso.identificacion,
    before: Object.fromEntries(CAMPOS.map((f) => [f, caso[f]])),
    after: Object.fromEntries(CAMPOS.map((f) => [f, patch[f] ?? caso[f]])),
    campos: Object.keys(patch),
  };
  if (String(caso.identificacion) === '1144158482') casoClave = row;
  if (samples.length < 25) samples.push(row);

  if (DRY) continue;

  await SegurosAlfaCaso.updateOne({ _id: caso._id }, { $set: { ...patch, updatedAt: new Date() } });
  const afterDoc = { ...caso, ...patch };
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: caso,
    afterDoc,
  });
  if (out) enqueued += 1;
}

console.log(
  JSON.stringify(
    {
      dry: DRY,
      casos: casos.length,
      patched,
      enqueued,
      caso1144158482: casoClave,
      samples,
    },
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
