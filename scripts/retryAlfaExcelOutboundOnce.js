import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { runAlfaExcelOutboundWorkerCycle } from '../workers/alfaExcelOutboundWorker.js';
import { runAlfaExcelSharePointDetectCycle } from '../services/alfaExcelSharePointImportService.js';

await mongoose.connect(process.env.MONGO_URI);
await AlfaExcelOutboundUpdate.updateOne(
  { _id: '6a7dbbad9451d64e4e0655a4' },
  {
    $set: {
      status: 'pending',
      attempts: 0,
      nextRetryAt: new Date(),
      lastError: null,
      lastErrorCode: null,
    },
  }
);
const c = await runAlfaExcelOutboundWorkerCycle({ batchSize: 3 });
console.log(JSON.stringify(c, null, 2));
const last = await AlfaExcelOutboundUpdate.findById('6a7dbbad9451d64e4e0655a4').lean();
console.log('status', last.status, 'err', last.lastError);
console.log('excel', last.sourceExcel);
console.log('match', last.match);
if (last.status === 'synced') {
  const d = await runAlfaExcelSharePointDetectCycle({ force: false });
  console.log('inbound', d.outcome, 'hasChanges', d.hasChanges);
  const s = await AlfaExcelSharePointSource.findOne({
    integrationKey: 'alfa-excel-control-seguimiento',
  }).lean();
  console.log('lastArnaldWrittenEtag', s.lastArnaldWrittenEtag);
}
await mongoose.disconnect();
