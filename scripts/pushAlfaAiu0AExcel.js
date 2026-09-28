/**
 * Cancela cola masiva, encola solo casos con AIU 0% (bug corregido) y drena.
 * node scripts/pushAlfaAiu0AExcel.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import {
  liquidadorAlfaTieneCifras,
  aplicarMontosOficialesDesdeLiquidadorAlfa,
} from '../utils/valoresLiquidadorAlfa.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

const FIELDS = [
  'valorReclamado',
  'valorLiquidado',
  'liquidadoCoberturaTerremo',
  'deducibleTerremoto',
  'valorLiquidacionCoberturasAdicionales',
  'deducibleCoberturasAdicionales',
  'valorTotalPagar',
  'reserva',
];

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
  socketTimeoutMS: 180000,
});

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
if (!src?.itemId || isAlfaExcelFinalProtectedName(src.fileName)) {
  console.error('ABORT', src?.fileName);
  process.exit(1);
}
console.log('Excel:', src.fileName);

// Pausar cola masiva previa (dejar solo failed/pending viejos como dead)
const cancelled = await AlfaExcelOutboundUpdate.updateMany(
  { status: { $in: ['pending', 'processing', 'failed'] } },
  {
    $set: {
      status: 'dead',
      lastError: 'CANCELLED_BULK_FOR_AIU0_PUSH',
      lastErrorCode: 'CANCELLED',
      nextRetryAt: null,
    },
  }
);
console.log('cancelled bulk', cancelled.modifiedCount);

const casos = await SegurosAlfaCaso.find({
  excluidoBaseAlfa: { $ne: true },
  liquidador: { $exists: true, $type: 'object' },
  'liquidador.liquidacionCotizacionPdf.aiuPorcentaje': 0,
})
  .select(['_id', 'consecutivo', 'identificacion', 'liquidador', ...FIELDS].join(' '))
  .lean();

const targets = [];
for (const caso of casos) {
  if (!liquidadorAlfaTieneCifras(caso.liquidador)) continue;
  const sanado = aplicarMontosOficialesDesdeLiquidadorAlfa(caso);
  if (sanado.valorLiquidado != null) sanado.reserva = sanado.valorLiquidado;
  const after = { ...caso };
  for (const f of FIELDS) {
    if (sanado[f] != null) after[f] = sanado[f];
  }
  if (!(Number(after.valorLiquidado) > 0 || Number(after.valorTotalPagar) > 0)) continue;
  targets.push({ caso, after });
}

console.log(JSON.stringify({
  aiu0ConLiquidador: casos.length,
  targets: targets.length,
  sample: targets.slice(0, 8).map((t) => ({
    consecutivo: t.caso.consecutivo,
    identificacion: t.caso.identificacion,
    valorLiquidado: t.after.valorLiquidado,
    valorTotalPagar: t.after.valorTotalPagar,
  })),
}, null, 2));

let enqueued = 0;
for (const { caso, after } of targets) {
  const before = { _id: caso._id };
  const afterDoc = { _id: caso._id, consecutivo: caso.consecutivo };
  for (const f of FIELDS) {
    const v = after[f];
    if (v == null || v === '') continue;
    before[f] = typeof v === 'number' ? v + 1 : `__diff_${f}`;
    afterDoc[f] = v;
  }
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: before,
    afterDoc,
  });
  if (out) enqueued += 1;
}
console.log({ enqueued });

let rounds = 0;
let synced = 0;
let failed = 0;
while (rounds < 120) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
  });
  if (pending === 0) break;
  rounds += 1;
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 4 });
  for (const r of summary?.results || []) {
    if (r?.outcome === 'synced') synced += 1;
    if (r?.outcome === 'failed' || r?.outcome === 'dead') failed += 1;
  }
  console.log(JSON.stringify({ round: rounds, pendingBefore: pending, synced, failed }));
}

const left = await AlfaExcelOutboundUpdate.countDocuments({
  status: { $in: ['pending', 'processing', 'failed'] },
});
const key = await SegurosAlfaCaso.findOne({ identificacion: '1144158482' })
  .select('_id')
  .lean();
const keyOut = key
  ? await AlfaExcelOutboundUpdate.findOne({ caseId: key._id }).sort({ updatedAt: -1 }).lean()
  : null;
console.log(
  JSON.stringify({
    done: true,
    fileName: src.fileName,
    rounds,
    synced,
    failed,
    left,
    caso1144158482: keyOut
      ? { status: keyOut.status, fields: Object.keys(keyOut.changes || {}), updatedAt: keyOut.updatedAt }
      : null,
  })
);
await mongoose.disconnect();
