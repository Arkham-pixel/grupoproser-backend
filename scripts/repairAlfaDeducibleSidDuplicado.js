/**
 * Repara montos Alfa cuando el SID del caso está ×2 vs liquidador cotización
 * (deducible duplicado en reporte/Excel) y resincroniza control de liquidación.
 *
 * node scripts/repairAlfaDeducibleSidDuplicado.js --dry-run
 * node scripts/repairAlfaDeducibleSidDuplicado.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import {
  aplicarMontosOficialesDesdeLiquidadorAlfa,
  liquidadorAlfaTieneCifras,
  extraerMontosLiquidadorAlfa,
} from '../utils/valoresLiquidadorAlfa.js';
import { parseCopMoney } from '../utils/alfaExcelNormalize.js';
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

function same(a, b) {
  return Number(a) === Number(b);
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
if (!DRY && (!src?.itemId || isAlfaExcelFinalProtectedName(src.fileName))) {
  console.error('ABORT', src?.fileName);
  process.exit(1);
}

const casos = await SegurosAlfaCaso.find({
  excluidoBaseAlfa: { $ne: true },
  liquidador: { $exists: true, $type: 'object' },
})
  .select(
    [
      '_id',
      'consecutivo',
      'identificacion',
      'valorAseguradoSid',
      'valorAseguradoInmueble',
      'liquidador',
      ...CAMPOS,
    ].join(' ')
  )
  .lean();

let patched = 0;
let enqueued = 0;
const samples = [];

for (const caso of casos) {
  if (!liquidadorAlfaTieneCifras(caso.liquidador)) continue;
  const montos = extraerMontosLiquidadorAlfa(caso.liquidador, caso);
  const sidCotiz = parseCopMoney(caso.liquidador?.liquidacionCotizacionPdf?.valorAseguradoSid);
  const sidCaso = Number(caso.valorAseguradoSid) || 0;
  const sanado = aplicarMontosOficialesDesdeLiquidadorAlfa(caso);
  if (sanado.valorLiquidado != null) sanado.reserva = sanado.valorLiquidado;

  const patch = {};
  for (const f of CAMPOS) {
    if (sanado[f] == null) continue;
    if (same(caso[f], sanado[f])) continue;
    patch[f] = sanado[f];
  }

  // Corregir SID del caso/encabezado si está ×2 respecto al SID de cotización.
  if (sidCotiz > 0 && sidCaso > 0 && Math.abs(sidCaso / sidCotiz - 2) < 0.02) {
    patch.valorAseguradoSid = sidCotiz;
    if (Number(caso.valorAseguradoInmueble) === sidCaso) {
      patch.valorAseguradoInmueble = sidCotiz;
    }
    const L = structuredClone(caso.liquidador);
    if (L.encabezado) {
      if (Number(L.encabezado.valorAseguradoSid) === sidCaso) {
        L.encabezado.valorAseguradoSid = sidCotiz;
      }
      if (Number(L.encabezado.valorAseguradoInmueble) === sidCaso) {
        L.encabezado.valorAseguradoInmueble = sidCotiz;
      }
      if (Number(L.encabezado.valorAsegurado) === sidCaso) {
        L.encabezado.valorAsegurado = sidCotiz;
      }
    }
    patch.liquidador = L;
  }

  if (!Object.keys(patch).length) continue;
  // Solo reportar si cambió deducible u otro campo de control / reclamado
  const moneyChanged = CAMPOS.some((f) => patch[f] != null);
  if (!moneyChanged && !patch.valorAseguradoSid) continue;

  patched += 1;
  if (samples.length < 30 || String(caso.consecutivo) === 'ALFA-2026-08-839') {
    samples.push({
      consecutivo: caso.consecutivo,
      identificacion: caso.identificacion,
      sidCasoAntes: sidCaso || null,
      sidCotiz: sidCotiz || null,
      sidUsadoCalc: montos.sid,
      before: Object.fromEntries(CAMPOS.map((f) => [f, caso[f]])),
      after: Object.fromEntries(CAMPOS.map((f) => [f, patch[f] ?? caso[f]])),
      campos: Object.keys(patch).filter((k) => k !== 'liquidador'),
    });
  }

  if (DRY) continue;

  await SegurosAlfaCaso.updateOne(
    { _id: caso._id },
    { $set: { ...patch, updatedAt: new Date() } }
  );

  const afterDoc = { ...caso, ...patch };
  const beforeDoc = { ...caso };
  // Forzar diff en campos de dinero tocados
  for (const f of CAMPOS) {
    if (patch[f] == null) continue;
    beforeDoc[f] = Number(patch[f]) === 0 ? 1 : Number(patch[f]) + 1;
  }
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc,
    afterDoc,
  });
  if (out) enqueued += 1;
}

console.log(
  JSON.stringify(
    {
      dry: DRY,
      scanned: casos.length,
      patched,
      enqueued,
      sample839: samples.find((s) => s.consecutivo === 'ALFA-2026-08-839') || null,
      samples: samples.slice(0, 15),
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
