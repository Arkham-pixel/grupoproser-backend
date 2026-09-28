/**
 * Crea fila Excel para ALFA-2026-08-197 (mismo ID que 159, otro riesgo)
 * y resincroniza montos de 159 + 197.
 * node scripts/fixAlfaExcelRiesgoDuplicado197.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import {
  aplicarMontosOficialesDesdeLiquidadorAlfa,
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
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';

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

const casos = await SegurosAlfaCaso.find({
  consecutivo: { $in: ['ALFA-2026-08-159', 'ALFA-2026-08-197'] },
}).lean();

console.log(
  'casos',
  casos.map((c) => ({
    consecutivo: c.consecutivo,
    id: c.identificacion,
    credito: c.numeroCredito,
    dir: c.direccionPredio,
    reclamado: c.valorReclamado,
  }))
);

// 1) Heal montos desde liquidador
for (const caso of casos) {
  if (!liquidadorAlfaTieneCifras(caso.liquidador)) continue;
  const sanado = aplicarMontosOficialesDesdeLiquidadorAlfa(caso);
  if (sanado.valorLiquidado != null) sanado.reserva = sanado.valorLiquidado;
  const patch = {};
  for (const f of CAMPOS) {
    if (sanado[f] == null) continue;
    if (moneyEq(caso[f], sanado[f])) continue;
    patch[f] = Math.round(Number(sanado[f]) || 0);
  }
  if (!Object.keys(patch).length) continue;
  console.log('heal', caso.consecutivo, patch);
  await SegurosAlfaCaso.updateOne(
    { _id: caso._id },
    { $set: { ...patch, updatedAt: new Date() } }
  );
  Object.assign(caso, patch);
}

// 2) Append fila faltante (197 ya no matchea la 303) — reintentar si ETag cambia
let append = null;
for (let i = 1; i <= 6; i += 1) {
  try {
    append = await syncMissingArnaldCasosToAlfaExcel({ apply: true, batchSize: 20,
      identificaciones: ['1130615893'],
    });
    console.log('append', append);
    break;
  } catch (err) {
    console.log('appendRetry', i, err.code || err.message);
    if (i === 6) throw err;
    await new Promise((r) => setTimeout(r, 2500 * i));
  }
}

// 3) Verificar match
const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
const downloaded = await downloadDriveItemBuffer({
  driveId: src.driveId,
  itemId: src.itemId,
});
const parsed = parseAlfaExcelBuffer(downloaded.buffer || downloaded);
const excelRows = parsed.rows || [];

for (const caso of casos) {
  const fresh = await SegurosAlfaCaso.findById(caso._id).lean();
  try {
    const hit = findExcelRowForCase(fresh, excelRows);
    console.log('match', {
      consecutivo: fresh.consecutivo,
      row: hit.rowNumber,
      strategy: hit.strategy,
      excelDir: hit.payload?.direccionPredio,
      excelCredito: hit.payload?.numeroCredito,
    });
  } catch (e) {
    console.log('matchFail', fresh.consecutivo, e.code || e.message);
  }
}

// 4) Encolar montos + identidad relevante
let enqueued = 0;
for (const caso of casos) {
  const fresh = await SegurosAlfaCaso.findById(caso._id).lean();
  const beforeDoc = { ...fresh };
  for (const f of [
    ...CAMPOS,
    'asegurado',
    'direccionPredio',
    'numeroCredito',
    'numeroPoliza',
    'tomador',
    'ciudad',
  ]) {
    const cur = fresh[f];
    if (typeof cur === 'number') beforeDoc[f] = cur === 0 ? 1 : cur + 1;
    else beforeDoc[f] = `${cur || ''}_old`;
  }
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc,
    afterDoc: fresh,
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
while (rounds < 40) {
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
    if (r?.consecutivo === 'ALFA-2026-08-197' || r?.consecutivo === 'ALFA-2026-08-159') {
      console.log('syncCase', r);
    }
  }
  console.log(JSON.stringify({ round: rounds, pendingBefore: pending, synced, failed }));
}

console.log(
  JSON.stringify({
    done: true,
    rounds,
    synced,
    failed,
    left: await AlfaExcelOutboundUpdate.countDocuments({
      status: { $in: ['pending', 'processing', 'failed'] },
    }),
  })
);

await mongoose.disconnect();
