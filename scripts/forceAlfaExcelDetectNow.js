/**
 * Fuerza detección Control y Seguimiento cuando el Excel creció
 * pero el banner quedó en "sin pendientes" por SKIP_ARNALD_GENERATED_VERSION.
 *
 * Uso: node scripts/forceAlfaExcelDetectNow.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import AlfaExcelImport from '../models/AlfaExcelImport.js';
import AlfaExcelImportRow from '../models/AlfaExcelImportRow.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { resetMicrosoftGraphClient } from '../services/microsoftGraphService.js';
import { runAlfaExcelSharePointDetectCycle } from '../services/alfaExcelSharePointImportService.js';

await mongoose.connect(process.env.MONGO_URI);

const beforeCount = await SegurosAlfaCaso.countDocuments({});
const srcBefore = await AlfaExcelSharePointSource.findOne({}).lean();
console.log(
  JSON.stringify({
    arnaldBefore: beforeCount,
    statusBefore: srcBefore?.status,
    outcomeBefore: srcBefore?.lastOutcome,
    lastArnaldWrittenEtag: srcBefore?.lastArnaldWrittenEtag || null,
    lastPreviewedEtag: srcBefore?.lastPreviewedEtag || null,
  })
);

resetMicrosoftGraphClient();
const cycle = await runAlfaExcelSharePointDetectCycle({ force: true });
console.log(
  JSON.stringify({
    outcome: cycle.outcome,
    status: cycle.status,
    hasChanges: cycle.hasChanges,
    hasIncidents: cycle.hasIncidents,
    summary: cycle.summary,
    importSessionId: cycle.importSessionId,
  })
);

const src = await AlfaExcelSharePointSource.findOne({}).lean();
console.log(
  JSON.stringify({
    statusAfter: src?.status,
    outcomeAfter: src?.lastOutcome,
    headlineReady: src?.status === 'updates_available' || src?.status === 'requires_review',
    lastPreviewImportId: src?.lastPreviewImportId
      ? String(src.lastPreviewImportId)
      : null,
    summary: src?.summary,
  })
);

if (src?.lastPreviewImportId) {
  const rows = await AlfaExcelImportRow.find({ importId: src.lastPreviewImportId })
    .select('action')
    .lean();
  const actions = {};
  for (const r of rows) actions[r.action] = (actions[r.action] || 0) + 1;
  console.log('actions', actions);

  const session = await AlfaExcelImport.findById(src.lastPreviewImportId).lean();
  console.log(
    JSON.stringify({
      sessionStatus: session?.status,
      alreadyImported: session?.alreadyImported,
      totals: session?.totals,
    })
  );
}

await mongoose.disconnect();
