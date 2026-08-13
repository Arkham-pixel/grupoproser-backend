/**
 * Pruebas detección Excel Alfa SharePoint (preview only, sin execute).
 * A–J (subconjunto ejecutable ahora).
 *
 * node scripts/testAlfaExcelSharePointDetect.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import {
  runAlfaExcelSharePointDetectCycle,
  selectAlfaExcelFromSharePointFolder,
  getAlfaExcelSharePointStatus,
} from '../services/alfaExcelSharePointImportService.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import { assertAlfaExcelSharePointPath } from '../utils/alfaExcelSharePointPath.js';

function pass(name) {
  console.log(`${name}: PASSED`);
}
function fail(name, err) {
  console.error(`${name}: FAILED`, err?.message || err);
  process.exitCode = 1;
}

async function main() {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri);
  const cfg = getAlfaExcelSharePointImportConfig();
  console.log('=== testAlfaExcelSharePointDetect ===');
  console.log('enabled=', cfg.cronEnabled, 'file=', cfg.fileName, 'path=', cfg.rootPath);

  const before = await SegurosAlfaCaso.countDocuments();
  const fpBefore = await SegurosAlfaCaso.find().select('_id updatedAt').lean();
  const fpMap = new Map(fpBefore.map((c) => [String(c._id), String(c.updatedAt)]));

  // Path guard
  try {
    assertAlfaExcelSharePointPath('SEGUROS ALFA/CONTROL Y SEGUIMIENTO');
    try {
      assertAlfaExcelSharePointPath('SEGUROS ALFA/PÓLIZAS/X');
      fail('I — path guard', new Error('debió bloquear PÓLIZAS'));
    } catch (e) {
      if (e.code === 'INVALID_ALFA_EXCEL_PATH') pass('I — path fuera de CONTROL bloqueado');
      else fail('I — path guard', e);
    }
  } catch (e) {
    fail('I — path guard', e);
  }

  // Selection
  const sel = await selectAlfaExcelFromSharePointFolder(cfg.rootPath, cfg.fileName);
  if (sel.outcome === 'SELECTED_BY_CONFIG' || sel.outcome === 'SELECTED_SINGLE_EXCEL') {
    pass(`B/select — ${sel.outcome}: ${sel.selected?.name}`);
  } else {
    fail('B/select', sel.outcome);
  }

  // First cycle
  const c1 = await runAlfaExcelSharePointDetectCycle({ force: true });
  console.log('cycle1', {
    outcome: c1.outcome,
    status: c1.status,
    hasChanges: c1.hasChanges,
    summary: c1.summary,
  });
  if (c1.outcome === 'ERROR') fail('C1', c1.error);
  else if (c1.hasChanges === false && c1.status === 'up_to_date') {
    pass('B — eTag/contenido → up_to_date (sin cambios reales)');
  } else {
    pass(`C1 — outcome=${c1.outcome} status=${c1.status}`);
  }

  // Same eTag → skip
  const c2 = await runAlfaExcelSharePointDetectCycle({ force: false });
  if (c2.outcome === 'SKIP_ALREADY_PREVIEWED') pass('A — mismo eTag → SKIP_ALREADY_PREVIEWED');
  else fail('A — skip', c2.outcome);

  // Status API shape
  const st = await getAlfaExcelSharePointStatus();
  if (st.uiStatus === 'error' && !st.source?.lastError) {
    fail('F — status error shape', st);
  } else {
    pass(`Status UI: ${st.uiStatus} — ${st.headline}`);
  }

  // Cases intact
  const after = await SegurosAlfaCaso.countDocuments();
  const fpAfter = await SegurosAlfaCaso.find().select('_id updatedAt').lean();
  let mutated = 0;
  for (const c of fpAfter) {
    if (fpMap.get(String(c._id)) !== String(c.updatedAt)) mutated += 1;
  }
  if (before === after && mutated === 0) pass('G — preview no modifica casos Mongo');
  else fail('G — casos mutados', { before, after, mutated });

  const src = await AlfaExcelSharePointSource.findOne({
    integrationKey: cfg.integrationKey,
  }).lean();
  console.log('checkpoint', {
    status: src?.status,
    lastPreviewedEtag: src?.lastPreviewedEtag,
    lastPreviewImportId: src?.lastPreviewImportId,
    lastOutcome: src?.lastOutcome,
  });

  console.log('\nMongo modificado (casos): NO');
  console.log('/execute ejecutado: NO');
  console.log('SharePoint modificado: NO');
  console.log('Cron config enabled=', cfg.cronEnabled);

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {
    /* */
  }
  process.exit(1);
});
