/**
 * Empuje final ARNALD → Excel Equidad SharePoint.
 * Encola una vez todos los casos terremoto y drena hasta vaciar (o max ciclos).
 *
 * node scripts/pushFinalArnaldToFdmExcel.js
 * node scripts/pushFinalArnaldToFdmExcel.js --max-cycles 80
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import {
  getEquidadFdmExcelSharePointConfig,
  FDM_EXCEL_OUTBOUND_FIELDS,
} from '../config/equidadFdmExcelSharePoint.js';
import { isSharePointConfigured } from '../config/sharepoint.js';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import EquidadFdmExcelOutboundUpdate from '../models/EquidadFdmExcelOutboundUpdate.js';
import {
  enqueueEquidadFdmExcelOutboundFromCaseUpdate,
  runEquidadFdmExcelOutboundCycle,
} from '../services/equidadFdmExcelOutboundService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const maxArg = process.argv.indexOf('--max-cycles');
const MAX_CYCLES = maxArg >= 0 ? Math.max(1, Number(process.argv[maxArg + 1]) || 80) : 80;

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const cfg = getEquidadFdmExcelSharePointConfig();
console.log('Config:', {
  rootPath: cfg.rootPath,
  fileName: cfg.fileName,
  outboundEnabled: cfg.outboundCronEnabled,
  sharePoint: isSharePointConfigured(),
});

if (!cfg.outboundCronEnabled || !isSharePointConfigured()) {
  console.error('Outbound o SharePoint no configurado');
  process.exit(1);
}

// Reintentar errores / stuck
await EquidadFdmExcelOutboundUpdate.updateMany(
  { status: { $in: ['error', 'processing'] } },
  { $set: { status: 'pending', nextRetryAt: null, attempts: 0, lastError: null } }
);

const casos = await EquidadFdmCaso.find({
  $or: [{ evento: cfg.eventoPreferido }, { evento: /TERREMOTO/i }],
}).lean();
console.log('Casos terremoto ARNALD:', casos.length);

let encolados = 0;
for (const caso of casos) {
  const fakeBefore = {};
  for (const campo of FDM_EXCEL_OUTBOUND_FIELDS) fakeBefore[campo] = null;
  const doc = await enqueueEquidadFdmExcelOutboundFromCaseUpdate(
    caso._id,
    fakeBefore,
    caso,
    { force: true }
  );
  if (doc) encolados += 1;
}
console.log('Encolados/actualizados en cola:', encolados);

let pending = await EquidadFdmExcelOutboundUpdate.countDocuments({ status: 'pending' });
console.log('Pending inicial:', pending);

let totalSynced = 0;
let totalAppended = 0;
let totalErrors = 0;

for (let i = 1; i <= MAX_CYCLES; i += 1) {
  pending = await EquidadFdmExcelOutboundUpdate.countDocuments({ status: 'pending' });
  console.log(`\n--- Ciclo ${i}/${MAX_CYCLES} (pending=${pending}) ---`);
  if (pending === 0) {
    console.log('Cola vacía.');
    break;
  }
  try {
    const summary = await runEquidadFdmExcelOutboundCycle({ batchSize: 40 });
    console.log(summary);
    totalSynced += summary.synced || 0;
    totalAppended += summary.appended || 0;
    totalErrors += summary.errors || 0;
  } catch (err) {
    console.error('Error ciclo:', err.message || err);
    if (/LOCKED|EXCEL_SOURCE_LOCKED/i.test(String(err.message || err))) {
      console.error('Cierra el Excel en SharePoint y vuelve a correr el script.');
      break;
    }
    // Reintentar tras pause corta
    await new Promise((r) => setTimeout(r, 5000));
  }
}

const cola = await EquidadFdmExcelOutboundUpdate.aggregate([
  { $group: { _id: '$status', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);
console.log('\n=== RESUMEN FINAL ===');
console.log({ totalSynced, totalAppended, totalErrors, cola });

await mongoose.disconnect();
