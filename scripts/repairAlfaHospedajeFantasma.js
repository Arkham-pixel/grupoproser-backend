/**
 * Quita hospedaje automático (1%/2% SID) y retiqueta id hospedaje en ítems reales.
 * node scripts/repairAlfaHospedajeFantasma.js
 * node scripts/repairAlfaHospedajeFantasma.js --dry-run
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { pesosOficialesAlfa } from '../utils/alfaExcelNormalize.js';
import {
  extraerMontosLiquidadorAlfa,
  esFilaHospedajeAlfa,
  limpiarLiquidadorHospedajeFantasmaAlfa,
} from '../utils/valoresLiquidadorAlfa.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

const DRY = process.argv.includes('--dry-run');

function tieneItemsNsrReales(liq = {}) {
  const rows = [
    ...(Array.isArray(liq.detalleLiquidacionCat) ? liq.detalleLiquidacionCat : []),
    ...(Array.isArray(liq.evaluacionSismicaNSR10?.presupuesto?.items)
      ? liq.evaluacionSismicaNSR10.presupuesto.items
      : []),
  ];
  return rows.some((it) => {
    const t = String(it?.descripcion || it?.actividad || it?.componente || '').trim();
    return t && !esFilaHospedajeAlfa(it);
  });
}

function coincideMontoPhantom(guardado, phantomMonto, aiuPct) {
  const g = Number(guardado);
  const p = Number(phantomMonto);
  if (!Number.isFinite(g) || g <= 0 || !Number.isFinite(p) || p <= 0) return false;
  let pct = Number(aiuPct);
  if (!Number.isFinite(pct)) pct = 0.2;
  if (pct > 1) pct /= 100;
  const conAiu = Math.round(p * (1 + pct));
  return Math.abs(g - conAiu) / Math.max(conAiu, 1) < 0.04;
}

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
  liquidador: { $exists: true, $ne: null, $type: 'object' },
}).lean();

const samples = [];
let changedN = 0;
let strippedN = 0;
let retaggedN = 0;
let moneyN = 0;
let enqueued = 0;

for (const caso of casos) {
  const cleaned = limpiarLiquidadorHospedajeFantasmaAlfa(caso.liquidador, caso);
  if (!cleaned.changed) continue;
  changedN += 1;
  strippedN += cleaned.stripped;
  retaggedN += cleaned.retagged;

  const aiuPct = caso.liquidador?.evaluacionSismicaNSR10?.presupuesto?.aiuPorcentaje;
  const patch = { liquidador: cleaned.liquidador };
  const nsrReales = tieneItemsNsrReales(cleaned.liquidador);

  // Recalcular solo si quedó presupuesto NSR real. No pisar Excel con cotización PDF.
  if (cleaned.stripped > 0 && nsrReales) {
    const montos = extraerMontosLiquidadorAlfa(cleaned.liquidador, caso);
    const rec = pesosOficialesAlfa(montos.valorReclamado);
    const liq = pesosOficialesAlfa(montos.valorLiquidado);
    if (rec != null && rec !== Number(caso.valorReclamado)) patch.valorReclamado = rec;
    if (liq != null && liq !== Number(caso.valorLiquidado)) patch.valorLiquidado = liq;
  } else if (cleaned.stripped > 0 && !nsrReales && cleaned.phantomMonto > 0) {
    if (coincideMontoPhantom(caso.valorReclamado, cleaned.phantomMonto, aiuPct)) {
      patch.valorReclamado = 0;
    }
    if (
      coincideMontoPhantom(caso.valorLiquidado, cleaned.phantomMonto, aiuPct) ||
      (patch.valorReclamado === 0 &&
        Number(caso.valorLiquidado) > 0 &&
        Math.abs(Number(caso.valorLiquidado) - Number(caso.valorReclamado)) /
          Math.max(Number(caso.valorReclamado) || 1, 1) <
          0.05)
    ) {
      patch.valorLiquidado = 0;
    }
  }

  const moneyChanged =
    Object.prototype.hasOwnProperty.call(patch, 'valorReclamado') ||
    Object.prototype.hasOwnProperty.call(patch, 'valorLiquidado');
  if (moneyChanged) moneyN += 1;

  if (samples.length < 16 && (cleaned.stripped > 0 || moneyChanged || samples.length < 4)) {
    samples.push({
      consecutivo: caso.consecutivo,
      stripped: cleaned.stripped,
      retagged: cleaned.retagged,
      phantomMonto: cleaned.phantomMonto,
      money: moneyChanged
        ? {
            reclamado: [caso.valorReclamado, patch.valorReclamado],
            liquidado: [caso.valorLiquidado, patch.valorLiquidado],
          }
        : null,
    });
  }

  if (DRY) continue;

  await SegurosAlfaCaso.updateOne({ _id: caso._id }, { $set: patch });
  if (moneyChanged) {
    const afterDoc = { ...caso, ...patch };
    const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
      beforeDoc: caso,
      afterDoc,
    });
    if (out) enqueued += 1;
  }
}

console.log(
  JSON.stringify(
    {
      dry: DRY,
      casos: casos.length,
      changed: changedN,
      strippedRows: strippedN,
      retaggedRows: retaggedN,
      moneyUpdated: moneyN,
      enqueued,
      samples,
    },
    null,
    2
  )
);

if (DRY) {
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
while (rounds < 40) {
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
