/**
 * Diagnóstico + arranque: ARNALD → Excel Equidad SharePoint.
 * - Muestra config/cola
 * - Encola campos outbound de casos terremoto con dato
 * - Corre ciclos outbound + syncMissing
 *
 * Uso: node scripts/activarOutboundFdmExcel.js
 *      node scripts/activarOutboundFdmExcel.js --cycles 5
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import { getEquidadFdmExcelSharePointConfig, FDM_EXCEL_OUTBOUND_FIELDS } from '../config/equidadFdmExcelSharePoint.js';
import { isSharePointConfigured } from '../config/sharepoint.js';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import EquidadFdmExcelOutboundUpdate from '../models/EquidadFdmExcelOutboundUpdate.js';
import {
  enqueueEquidadFdmExcelOutboundFromCaseUpdate,
  runEquidadFdmExcelOutboundCycle,
} from '../services/equidadFdmExcelOutboundService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const cyclesArg = process.argv.indexOf('--cycles');
const CYCLES = cyclesArg >= 0 ? Math.max(1, Number(process.argv[cyclesArg + 1]) || 3) : 3;

const esVacio = (v) =>
  v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v));

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 30000,
});

const cfg = getEquidadFdmExcelSharePointConfig();
console.log('--- Config Equidad FDM Excel ---');
console.log({
  rootPath: cfg.rootPath,
  fileName: cfg.fileName,
  importCronEnabled: cfg.importCronEnabled,
  outboundCronEnabled: cfg.outboundCronEnabled,
  outboundCronSchedule: cfg.outboundCronSchedule,
  outboundBatchSize: cfg.outboundBatchSize,
  sharePointConfigured: isSharePointConfigured(),
});

if (!cfg.outboundCronEnabled) {
  console.error('❌ SHAREPOINT_EQUIDAD_FDM_EXCEL_OUTBOUND_ENABLED no está en true');
  process.exit(1);
}
if (!isSharePointConfigured()) {
  console.error('❌ MS_* SharePoint no configurado');
  process.exit(1);
}

const cola = await EquidadFdmExcelOutboundUpdate.aggregate([
  { $group: { _id: '$status', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);
console.log('Cola outbound por estado:', cola);

const casos = await EquidadFdmCaso.find({
  $or: [{ evento: cfg.eventoPreferido }, { evento: /TERREMOTO/i }],
})
  .select([...FDM_EXCEL_OUTBOUND_FIELDS, 'consecutivo', 'cedula', 'nombre', 'evento'].join(' '))
  .lean();

console.log('Casos terremoto ARNALD:', casos.length);

let encolados = 0;
let sinCambios = 0;
for (const caso of casos) {
  const before = {};
  const after = { ...caso };
  // Forzar encolado de campos outbound que tengan valor (primera carga hacia Excel).
  const fakeBefore = {};
  for (const campo of FDM_EXCEL_OUTBOUND_FIELDS) {
    fakeBefore[campo] = null;
  }
  const doc = await enqueueEquidadFdmExcelOutboundFromCaseUpdate(caso._id, fakeBefore, after, {
    force: true,
  });
  if (doc) encolados += 1;
  else sinCambios += 1;
}
console.log({ encolados, sinCambios });

const pendingAfter = await EquidadFdmExcelOutboundUpdate.countDocuments({ status: 'pending' });
console.log('Pending tras encolar:', pendingAfter);

for (let i = 1; i <= CYCLES; i += 1) {
  console.log(`\n--- Ciclo outbound ${i}/${CYCLES} ---`);
  try {
    const summary = await runEquidadFdmExcelOutboundCycle({
      batchSize: Math.max(cfg.outboundBatchSize, 25),
    });
    console.log(summary);
    const still = await EquidadFdmExcelOutboundUpdate.countDocuments({ status: 'pending' });
    console.log('Pending restantes:', still);
    if (still === 0 && !(summary.appended > 0)) break;
  } catch (err) {
    console.error('Error ciclo:', err.message || err);
    if (/LOCKED|EXCEL_SOURCE_LOCKED/i.test(String(err.message || err))) {
      console.error('Excel abierto en SharePoint/Desktop. Ciérralo y reintenta.');
    }
    break;
  }
}

const finalCola = await EquidadFdmExcelOutboundUpdate.aggregate([
  { $group: { _id: '$status', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);
console.log('\nCola final:', finalCola);

await mongoose.disconnect();
console.log('Listo.');
