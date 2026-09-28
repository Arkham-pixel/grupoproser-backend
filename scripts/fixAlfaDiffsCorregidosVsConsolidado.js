/**
 * Alinea en consolidado los casos con DIFF (coberturas adicionales)
 * y agrega ALFA-2026-08-279 si falta.
 * node scripts/fixAlfaDiffsCorregidosVsConsolidado.js
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
  syncMissingArnaldCasosToAlfaExcel,
  findExcelRowForCase,
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import { downloadDriveItemBuffer } from '../services/microsoftGraphService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

const TARGETS = [
  'ALFA-2026-08-159',
  'ALFA-2026-08-201',
  'ALFA-2026-08-279',
  'ALFA-2026-08-320',
  'ALFA-2026-08-772',
  'ALFA-2026-08-1977',
  'ALFA-2026-08-2175',
];

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

const casos = await SegurosAlfaCaso.find({ consecutivo: { $in: TARGETS } }).lean();
console.log(
  'casos',
  casos.map((c) => ({
    consecutivo: c.consecutivo,
    id: c.identificacion,
    cobAdic: c.valorLiquidacionCoberturasAdicionales,
  }))
);

// 1) Heal Mongo desde liquidador
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
  console.log(
    JSON.stringify({
      consecutivo: caso.consecutivo,
      liquidadorCobAdic: Math.round(Number(montos.valorLiquidacionCoberturasAdicionales) || 0),
      mongoCobAdic: Math.round(Number(caso.valorLiquidacionCoberturasAdicionales) || 0),
      patch,
    })
  );
  if (Object.keys(patch).length) {
    await SegurosAlfaCaso.updateOne(
      { _id: caso._id },
      { $set: { ...patch, updatedAt: new Date() } }
    );
    Object.assign(caso, patch);
  }
}

// 2) Append faltantes (279)
const ids = [...new Set(casos.map((c) => String(c.identificacion || '')).filter(Boolean))];
let append = null;
for (let i = 1; i <= 8; i += 1) {
  try {
    append = await syncMissingArnaldCasosToAlfaExcel({ apply: true, batchSize: 20,
      identificaciones: ids,
    });
    console.log('append', append);
    break;
  } catch (err) {
    console.log('appendRetry', i, err.code || err.message);
    await new Promise((r) => setTimeout(r, 3000 * i));
  }
}

// 3) Encolar montos (forzar coberturas adicionales)
const freshCasos = await SegurosAlfaCaso.find({ consecutivo: { $in: TARGETS } }).lean();
let enqueued = 0;
for (const caso of freshCasos) {
  const before = { ...caso };
  for (const f of CAMPOS) {
    const cur = Number(caso[f]) || 0;
    before[f] = cur === 0 ? 1 : cur + 1;
  }
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: before,
    afterDoc: caso,
  });
  if (out) enqueued += 1;
}
console.log({ enqueued });

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
    if (TARGETS.includes(r?.consecutivo)) console.log('case', JSON.stringify(r));
  }
  console.log(JSON.stringify({ round: rounds, pendingBefore: pending, synced, failed }));
}

// 4) Verificar vs liquidador en consolidado
const downloaded = await downloadDriveItemBuffer({
  driveId: src.driveId,
  itemId: src.itemId,
});
const excelRows = parseAlfaExcelBuffer(downloaded.buffer || downloaded).rows || [];
const verify = [];
for (const caso of await SegurosAlfaCaso.find({ consecutivo: { $in: TARGETS } }).lean()) {
  const calc = liquidadorAlfaTieneCifras(caso.liquidador)
    ? extraerMontosLiquidadorAlfa(caso.liquidador, caso)
    : null;
  let hit = null;
  let err = null;
  try {
    hit = findExcelRowForCase(caso, excelRows);
  } catch (e) {
    err = e.code || e.message;
  }
  const esperado = {
    valorReclamado: Math.round(Number(calc?.valorReclamado) || 0),
    valorLiquidado: Math.round(Number(calc?.valorLiquidado) || 0),
    liquidadoCoberturaTerremo: Math.round(Number(calc?.liquidadoCoberturaTerremo) || 0),
    deducibleTerremoto: Math.round(Number(calc?.deducibleTerremoto) || 0),
    valorLiquidacionCoberturasAdicionales: Math.round(
      Number(calc?.valorLiquidacionCoberturasAdicionales) || 0
    ),
    valorTotalPagar: Math.round(Number(calc?.valorTotalPagar) || 0),
    reserva: Math.round(Number(calc?.valorLiquidado) || 0),
  };
  const diffs = {};
  if (!hit) {
    verify.push({ consecutivo: caso.consecutivo, error: err || 'SIN_FILA' });
    continue;
  }
  for (const [k, v] of Object.entries(esperado)) {
    const excel = Math.round(Number(hit.payload?.[k]) || 0);
    if (excel !== v) diffs[k] = { excel, esperado: v };
  }
  verify.push({
    consecutivo: caso.consecutivo,
    excelRow: hit.rowNumber,
    ok: Object.keys(diffs).length === 0,
    diffs: Object.keys(diffs).length ? diffs : null,
    cobAdic: esperado.valorLiquidacionCoberturasAdicionales,
  });
}

console.log(
  JSON.stringify(
    {
      done: true,
      fileName: src.fileName,
      rounds,
      synced,
      failed,
      left: await AlfaExcelOutboundUpdate.countDocuments({
        status: { $in: ['pending', 'processing', 'failed'] },
      }),
      verify,
    },
    null,
    2
  )
);

await mongoose.disconnect();
process.exit(verify.some((v) => !v.ok || v.error) ? 2 : 0);
