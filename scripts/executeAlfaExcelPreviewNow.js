/**
 * Aplica el preview SharePoint Alfa actual (CREATED/UPDATED).
 * Uso: node scripts/executeAlfaExcelPreviewNow.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { executeAlfaExcelImport } from '../services/alfaExcelImportService.js';

await mongoose.connect(process.env.MONGO_URI);
const before = await SegurosAlfaCaso.countDocuments({});
const src = await AlfaExcelSharePointSource.findOne({}).lean();
if (!src?.lastPreviewImportId) {
  console.error('No hay lastPreviewImportId');
  process.exit(1);
}

console.log(
  JSON.stringify({
    before,
    sessionId: String(src.lastPreviewImportId),
    status: src.status,
    summary: src.summary,
  })
);

const result = await executeAlfaExcelImport({
  importSessionId: String(src.lastPreviewImportId),
  force: true,
  user: { login: 'force-sync', nombre: 'Force Sync Alfa Excel' },
});

const after = await SegurosAlfaCaso.countDocuments({});
console.log(
  JSON.stringify({
    after,
    delta: after - before,
    totals: result?.totals,
    status: result?.status,
  })
);

// Marcar source como al día tras execute exitoso
await AlfaExcelSharePointSource.updateOne(
  { integrationKey: src.integrationKey },
  {
    $set: {
      status: 'up_to_date',
      hasChanges: false,
      lastOutcome: 'EXECUTED',
      lastProcessedEtag: src.lastPreviewedEtag || src.eTag,
      'notification.pending': false,
    },
  }
);

await mongoose.disconnect();
