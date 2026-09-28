/**
 * Post-QA: repara diffs Mongo claros + cotizaciones ×100 + push Excel seguro.
 * node scripts/repairAlfaPostQaMontos.js
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
import { parseCopMoney } from '../utils/alfaExcelNormalize.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const qa = JSON.parse(
  fs.readFileSync(path.join(__dirname, '_qa_alfa_montos_todos.json'), 'utf8')
);

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

function fixCotizX100(liquidador = {}) {
  const L = structuredClone(liquidador);
  let changed = 0;
  const slots = [];
  if (L.cotizacionesPdf && typeof L.cotizacionesPdf === 'object') {
    for (const k of ['materiales', 'manoObra', 'completo']) {
      if (L.cotizacionesPdf[k]) slots.push(L.cotizacionesPdf[k]);
    }
  }
  if (L.cotizacionPdf) slots.push(L.cotizacionPdf);
  for (const slot of slots) {
    const m = parseCopMoney(slot.montoFinal);
    if (m == null || m < 1_000_000_000) continue; // solo sospechosos ≥ 1.000M
    const sano = Math.round(m / 100);
    if (sano <= 0) continue;
    slot.montoFinal = String(sano);
    changed += 1;
  }
  return { liquidador: L, changed };
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

const x100Consec = new Set(
  (qa.diffsExcel || [])
    .filter((d) => {
      const ratios = Object.values(d.diffs || {})
        .filter((v) => v.before > 0 && v.after > 0)
        .map((v) => v.after / v.before);
      if (!ratios.length) return false;
      const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      return avg > 50 && avg < 150;
    })
    .map((d) => d.consecutivo)
);

const mongoDiffConsec = new Set((qa.diffsMongo || []).map((d) => d.consecutivo));
const excelStaleConsec = new Set(
  (qa.diffsExcel || [])
    .filter((d) => !x100Consec.has(d.consecutivo))
    .map((d) => d.consecutivo)
);

const targets = new Set([...mongoDiffConsec, ...x100Consec, ...excelStaleConsec]);
const casos = await SegurosAlfaCaso.find({
  consecutivo: { $in: [...targets] },
  excluidoBaseAlfa: { $ne: true },
})
  .select(['_id', 'consecutivo', 'identificacion', 'liquidador', ...CAMPOS].join(' '))
  .lean();

let fixedMongo = 0;
let fixedCotiz = 0;
let enqueued = 0;
const log = [];

for (const caso of casos) {
  if (!liquidadorAlfaTieneCifras(caso.liquidador) && !x100Consec.has(caso.consecutivo)) {
    continue;
  }

  let liquidador = caso.liquidador;
  const patch = {};

  if (x100Consec.has(caso.consecutivo)) {
    const fx = fixCotizX100(liquidador);
    if (fx.changed) {
      liquidador = fx.liquidador;
      patch.liquidador = liquidador;
      fixedCotiz += 1;
    }
  }

  const sanado = aplicarMontosOficialesDesdeLiquidadorAlfa({ ...caso, liquidador });
  if (sanado.valorLiquidado != null) sanado.reserva = sanado.valorLiquidado;
  for (const f of CAMPOS) {
    if (sanado[f] == null) continue;
    if (moneyEq(caso[f], sanado[f])) continue;
    patch[f] = Math.round(Number(sanado[f]) || 0);
  }

  // Solo encolar Excel si el resultado NO queda ×100 vs Excel previo
  const excelDiff = (qa.diffsExcel || []).find((d) => d.consecutivo === caso.consecutivo);
  let skipExcel = false;
  if (excelDiff && x100Consec.has(caso.consecutivo)) {
    // Tras ÷100 cotiz, montos deben acercarse al Excel (before del QA)
    const recExcel = excelDiff.diffs?.valorReclamado?.before;
    const recNew = patch.valorReclamado ?? caso.valorReclamado;
    if (recExcel > 0 && Math.abs(recNew / recExcel - 1) > 0.05) {
      skipExcel = true;
    }
  }

  if (!Object.keys(patch).length) {
    // Mongo ok pero Excel stale → forzar enqueue de campos flat
    if (excelStaleConsec.has(caso.consecutivo) && !x100Consec.has(caso.consecutivo)) {
      // No empujar ceros sobre Excel si el liquidador aún no tiene daños.
      const tieneDanios = CAMPOS.some((f) => Math.round(Number(caso[f]) || 0) > 0);
      if (!tieneDanios) {
        log.push({ consecutivo: caso.consecutivo, action: 'skip_excel_zero' });
        continue;
      }
      const beforeDoc = { ...caso };
      const afterDoc = { ...caso };
      for (const f of CAMPOS) {
        beforeDoc[f] = Number(caso[f]) === 0 ? 1 : Number(caso[f] || 0) + 1;
      }
      const out = await enqueueAlfaExcelOutboundFromCaseUpdate({ beforeDoc, afterDoc });
      if (out) {
        enqueued += 1;
        log.push({ consecutivo: caso.consecutivo, action: 'excel_stale_push' });
      }
    }
    continue;
  }

  await SegurosAlfaCaso.updateOne(
    { _id: caso._id },
    { $set: { ...patch, updatedAt: new Date() } }
  );
  fixedMongo += 1;

  const afterDoc = { ...caso, ...patch };
  const beforeDoc = { ...caso };
  for (const f of CAMPOS) {
    if (patch[f] == null) continue;
    beforeDoc[f] = Number(patch[f]) === 0 ? 1 : Number(patch[f]) + 1;
  }
  if (!skipExcel) {
    const out = await enqueueAlfaExcelOutboundFromCaseUpdate({ beforeDoc, afterDoc });
    if (out) enqueued += 1;
  }
  log.push({
    consecutivo: caso.consecutivo,
    action: x100Consec.has(caso.consecutivo) ? 'cotiz_x100+montos' : 'montos',
    campos: Object.keys(patch).filter((k) => k !== 'liquidador'),
    skipExcel,
  });
}

console.log(JSON.stringify({ fixedMongo, fixedCotiz, enqueued, log }, null, 2));

await AlfaExcelOutboundUpdate.updateMany(
  { status: { $in: ['processing', 'failed'] } },
  { $set: { status: 'pending', nextRetryAt: new Date(), attempts: 0 } }
);

let rounds = 0;
let synced = 0;
let failed = 0;
while (rounds < 80) {
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

const left = await AlfaExcelOutboundUpdate.countDocuments({
  status: { $in: ['pending', 'processing', 'failed'] },
});
console.log(JSON.stringify({ done: true, fileName: src.fileName, rounds, synced, failed, left }));
await mongoose.disconnect();
