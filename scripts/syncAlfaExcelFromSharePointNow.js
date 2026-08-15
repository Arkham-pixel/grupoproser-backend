/**
 * Fuerza preview SharePoint + execute import Excel Alfa → casos ARNALD.
 * node scripts/syncAlfaExcelFromSharePointNow.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  runAlfaExcelSharePointDetectCycle,
  getAlfaExcelSharePointStatus,
  markAlfaExcelSharePointExecuted,
} from '../services/alfaExcelSharePointImportService.js';
import { executeAlfaExcelImport } from '../services/alfaExcelImportService.js';
import { resetMicrosoftGraphClient } from '../services/microsoftGraphService.js';

async function main() {
  resetMicrosoftGraphClient();
  await mongoose.connect(process.env.MONGO_URI);

  const before = await SegurosAlfaCaso.countDocuments();
  console.log(JSON.stringify({ step: 'before', casos: before }, null, 2));

  const cycle = await runAlfaExcelSharePointDetectCycle({ force: true });
  const importSessionId =
    cycle.importSessionId ||
    cycle.source?.lastPreviewImportId ||
    null;

  console.log(
    JSON.stringify(
      {
        step: 'detect',
        outcome: cycle.outcome,
        status: cycle.status,
        importSessionId,
        summary: cycle.summary || cycle.source?.summary || null,
        error: cycle.error || cycle.lastError || null,
      },
      null,
      2
    )
  );

  if (!importSessionId) {
    const status = await getAlfaExcelSharePointStatus();
    console.error('NO_IMPORT_SESSION');
    console.log(JSON.stringify({ status }, null, 2));
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const executed = await executeAlfaExcelImport({
    importSessionId: String(importSessionId),
    force: true,
    user: { login: 'sync-script', rol: 'admin' },
  });

  try {
    await markAlfaExcelSharePointExecuted({
      importSessionId: String(importSessionId),
    });
  } catch (e) {
    console.warn('markAfterExecute:', e.message);
  }

  const after = await SegurosAlfaCaso.countDocuments();
  console.log(
    JSON.stringify(
      {
        step: 'after',
        casos: after,
        delta: after - before,
        executeTotals: executed?.totals || executed,
        importSessionId: String(importSessionId),
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('FAIL', err.message);
  console.error(err.stack);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
