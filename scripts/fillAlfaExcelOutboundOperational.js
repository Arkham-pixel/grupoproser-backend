/**
 * Enlaza el consolidado OPERATIVO (sin _Final) y encola/llena columnas amarillas
 * desde todos los casos ARNALD → SharePoint.
 *
 * node scripts/fillAlfaExcelOutboundOperational.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { runAlfaExcelSharePointDetectCycle } from '../services/alfaExcelSharePointImportService.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

await mongoose.connect(process.env.MONGO_URI);

const cfg = getAlfaExcelOutboundConfig();
console.log('config', {
  fileName: cfg.fileName,
  rootPath: cfg.rootPath,
  outboundEnabled: cfg.cronEnabled,
});

// 1) Detectar/seleccionar el Excel operativo (nunca _Final)
const detect = await runAlfaExcelSharePointDetectCycle({ force: true });
const source = await AlfaExcelSharePointSource.findOne({
  integrationKey: cfg.integrationKey,
}).lean();

console.log('detect', {
  outcome: detect.outcome,
  status: detect.status,
  fileName: source?.fileName,
  itemId: source?.itemId ? String(source.itemId).slice(0, 12) + '…' : null,
});

if (!source?.itemId || isAlfaExcelFinalProtectedName(source.fileName)) {
  console.error('ABORT: no se enlazó el consolidado operativo', {
    fileName: source?.fileName,
    itemId: source?.itemId,
  });
  await mongoose.disconnect();
  process.exit(1);
}

// 2) Encolar todos los casos con datos amarillos (before vacío → fuerza fill)
const casos = await SegurosAlfaCaso.find({}).lean();
let enqueued = 0;
let skipped = 0;
for (const caso of casos) {
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: { _id: caso._id },
    afterDoc: caso,
  });
  if (out) enqueued += 1;
  else skipped += 1;
}
console.log('enqueue', { casos: casos.length, enqueued, skipped });

// 3) Procesar cola hasta vaciar (límite de seguridad)
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
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 15 });
  const results = summary?.results || [];
  for (const r of results) {
    if (r?.outcome === 'synced' || r?.outcome === 'done') synced += 1;
    if (r?.outcome === 'failed' || r?.outcome === 'dead') failed += 1;
  }
  console.log(`round ${rounds}`, {
    pendingBefore: pending,
    processed: results.length,
    summary: summary?.counts || summary,
  });
}

const byStatus = await AlfaExcelOutboundUpdate.aggregate([
  { $group: { _id: '$status', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);

const recentFailed = await AlfaExcelOutboundUpdate.find({ status: 'failed' })
  .sort({ updatedAt: -1 })
  .limit(8)
  .select('consecutivo field lastError lastErrorCode excelRowNumber')
  .lean();

console.log(
  JSON.stringify(
    {
      ok: true,
      fileName: source.fileName,
      rounds,
      syncedApprox: synced,
      failedApprox: failed,
      byStatus,
      recentFailed,
    },
    null,
    2
  )
);

await mongoose.disconnect();
