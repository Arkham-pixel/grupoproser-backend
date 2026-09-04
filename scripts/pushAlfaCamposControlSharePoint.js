/**
 * Encola ARNALD → SharePoint (Control y Seguimiento) los campos de control
 * de liquidación que el usuario insertó en el consolidado:
 * Y  LIQUIDADO COBERTURA TERREMOTO
 * Z  DEDUCIBLE TERREMOTO
 * AA VALOR LIQUIDACIÓN COBERTURAS ADICIONALES
 * AB DEDUCIBLE COBERTURAS ADICIONALES
 * AC VALOR TOTAL A PAGAR
 * (+ X VALOR LIQUIDADO y V RESERVA alineados al liquidador)
 *
 * node scripts/pushAlfaCamposControlSharePoint.js --dry-run
 * node scripts/pushAlfaCamposControlSharePoint.js
 * node scripts/pushAlfaCamposControlSharePoint.js --no-drain
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';
import { getOutboundWritableFields } from '../config/alfaExcelOwnershipMap.js';

const DRY = process.argv.includes('--dry-run');
const NO_DRAIN = process.argv.includes('--no-drain');
const DRAIN_ONLY = process.argv.includes('--drain-only');

const FIELDS = [
  'valorLiquidado',
  'liquidadoCoberturaTerremo',
  'deducibleTerremoto',
  'valorLiquidacionCoberturasAdicionales',
  'deducibleCoberturasAdicionales',
  'valorTotalPagar',
  'reserva',
];

await mongoose.connect(process.env.MONGO_URI);

const writable = new Set(getOutboundWritableFields());
for (const f of FIELDS) {
  if (!writable.has(f)) {
    console.error('ABORT campo no writable', f);
    await mongoose.disconnect();
    process.exit(1);
  }
}

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
if (!src?.itemId || isAlfaExcelFinalProtectedName(src.fileName)) {
  console.error('ABORT source', src?.fileName, src?.itemId);
  await mongoose.disconnect();
  process.exit(1);
}
console.log(
  JSON.stringify({
    event: 'TARGET',
    fileName: src.fileName,
    dry: DRY,
    noDrain: NO_DRAIN,
    drainOnly: DRAIN_ONLY,
  })
);

let enqueued = 0;
let skipped = 0;
const samples = [];

if (!DRAIN_ONLY) {
  const casos = await SegurosAlfaCaso.find({
    $or: FIELDS.map((f) => ({ [f]: { $ne: null } })),
  })
    .select(['_id', 'consecutivo', ...FIELDS].join(' '))
    .lean();

  for (const caso of casos) {
    const dummyBefore = { _id: caso._id };
    const afterDoc = { _id: caso._id, consecutivo: caso.consecutivo };
    let has = false;
    for (const field of FIELDS) {
      const v = caso[field];
      if (v == null || v === '') continue;
      dummyBefore[field] = typeof v === 'number' && Number.isFinite(v) ? v + 1 : `__diff_${field}`;
      afterDoc[field] = v;
      has = true;
    }
    if (!has) {
      skipped += 1;
      continue;
    }
    if (samples.length < 5) {
      samples.push({
        consecutivo: caso.consecutivo,
        valorTotalPagar: caso.valorTotalPagar,
        liquidadoCoberturaTerremo: caso.liquidadoCoberturaTerremo,
      });
    }
    if (DRY) {
      enqueued += 1;
      continue;
    }
    const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
      beforeDoc: dummyBefore,
      afterDoc,
    });
    if (out) enqueued += 1;
    else skipped += 1;
  }

  console.log(
    JSON.stringify({ casos: casos.length, enqueued, skipped, samples }, null, 2)
  );
} else {
  const pendingNow = await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
  });
  console.log(JSON.stringify({ event: 'DRAIN_ONLY', pending: pendingNow }));
}

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
while (rounds < 200) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
  });
  if (pending === 0) break;
  rounds += 1;
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 8 });
  const results = summary?.results || [];
  for (const r of results) {
    if (r?.outcome === 'synced') synced += 1;
    if (r?.outcome === 'failed' || r?.outcome === 'dead') failed += 1;
  }
  console.log(JSON.stringify({ round: rounds, pendingBefore: pending, synced, failed }));
}

console.log(JSON.stringify({ done: true, fileName: src.fileName, rounds, synced, failed }));
await mongoose.disconnect();
