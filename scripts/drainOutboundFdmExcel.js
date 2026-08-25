/**
 * Solo drena la cola outbound FDM (no re-encola).
 * node scripts/drainOutboundFdmExcel.js --cycles 50
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import { getEquidadFdmExcelSharePointConfig } from '../config/equidadFdmExcelSharePoint.js';
import EquidadFdmExcelOutboundUpdate from '../models/EquidadFdmExcelOutboundUpdate.js';
import { runEquidadFdmExcelOutboundCycle } from '../services/equidadFdmExcelOutboundService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);
const cyclesArg = process.argv.indexOf('--cycles');
const CYCLES = cyclesArg >= 0 ? Math.max(1, Number(process.argv[cyclesArg + 1]) || 20) : 20;

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 30000,
});
const cfg = getEquidadFdmExcelSharePointConfig();

for (let i = 1; i <= CYCLES; i += 1) {
  const pending = await EquidadFdmExcelOutboundUpdate.countDocuments({ status: 'pending' });
  console.log(`\n--- Ciclo ${i}/${CYCLES} (pending=${pending}) ---`);
  if (pending === 0) {
    console.log('Cola vacía.');
    break;
  }
  try {
    const summary = await runEquidadFdmExcelOutboundCycle({
      batchSize: Math.max(cfg.outboundBatchSize || 10, 30),
    });
    console.log(summary);
  } catch (err) {
    console.error('Error:', err.message || err);
    if (/LOCKED|EXCEL_SOURCE_LOCKED/i.test(String(err.message || err))) {
      console.error('Cierra el Excel en SharePoint/Desktop y reintenta.');
      break;
    }
  }
}

const cola = await EquidadFdmExcelOutboundUpdate.aggregate([
  { $group: { _id: '$status', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);
console.log('\nCola final:', cola);
await mongoose.disconnect();
