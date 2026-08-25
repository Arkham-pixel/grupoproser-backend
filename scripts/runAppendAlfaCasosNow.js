/**
 * Pausa cola outbound + append filas faltantes al consolidado operativo.
 * node scripts/runAppendAlfaCasosNow.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { syncMissingArnaldCasosToAlfaExcel } from '../services/alfaExcelOutboundService.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import {
  resolveDriveContext,
  downloadDriveItemBuffer,
  getItemMetadata,
} from '../services/microsoftGraphService.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

await mongoose.connect(process.env.MONGO_URI);

const far = new Date(Date.now() + 3 * 60 * 60 * 1000);
const paused = await AlfaExcelOutboundUpdate.updateMany(
  { status: { $in: ['pending', 'processing', 'retry'] } },
  { $set: { status: 'pending', nextRetryAt: far } }
);
console.log('paused_outbound', paused.modifiedCount ?? paused.nModified);
await sleep(8000);

let lastErr = null;
let result = null;
for (let attempt = 1; attempt <= 10; attempt += 1) {
  try {
    result = await syncMissingArnaldCasosToAlfaExcel({ batchSize: 80 });
    lastErr = null;
    console.log('append_result', JSON.stringify(result));
    break;
  } catch (e) {
    lastErr = e;
    console.warn('attempt_fail', attempt, e.code || '', e.message);
    await sleep(/LOCK|ECONN|ETIMEDOUT|ETAG/i.test(`${e.code || ''}${e.message || ''}`) ? 20000 : 5000);
  }
}

if (lastErr) {
  console.error('APPEND_FAILED', lastErr.code || lastErr.message);
  process.exitCode = 1;
} else {
  // Verificar filas reales en SharePoint
  const src = await AlfaExcelSharePointSource.findOne({
    integrationKey: 'alfa-excel-control-seguimiento',
  }).lean();
  const meta = await getItemMetadata(src.itemId);
  const dl = await downloadDriveItemBuffer({
    driveId: meta.parentReference?.driveId || src.driveId,
    itemId: src.itemId,
  });
  const parsed = parseAlfaExcelBuffer(dl.buffer || dl);
  console.log(
    JSON.stringify(
      {
        ok: true,
        fileName: meta.name,
        rowsInExcelNow: parsed.rows?.length ?? 0,
        appended: result?.appended ?? 0,
      },
      null,
      2
    )
  );
}

await mongoose.disconnect();
