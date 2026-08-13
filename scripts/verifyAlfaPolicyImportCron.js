/**
 * Verificación post-activación del cron de pólizas Alfa.
 *   node scripts/verifyAlfaPolicyImportCron.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import { getAlfaPolicyImportConfig } from '../config/alfaPolicyImport.js';
import {
  iniciarCronAlfaPolicyImport,
  isCronAlfaPolicyImportActive,
  detenerCronAlfaPolicyImport,
} from '../services/cronAlfaPolicyImportService.js';
import { runAlfaPolicyImportWorkerCycle } from '../workers/alfaPolicyImportWorker.js';
import { ALFA_POLICY_IMPORT_PREFIX } from '../utils/alfaPolicySharePointPath.js';

await mongoose.connect(process.env.MONGO_URI);

const cfg = getAlfaPolicyImportConfig();

console.log('POLICY IMPORT ENABLED:', cfg.cronEnabled);
console.log('CRON:', cfg.cronSchedule);
console.log('SOURCE PATH:', cfg.rootPath);

iniciarCronAlfaPolicyImport();
const registered = isCronAlfaPolicyImportActive();
console.log('CRON REGISTERED:', registered);

const summary = await runAlfaPolicyImportWorkerCycle({ batchSize: cfg.batchSize });

const polizasRoot = (summary.roots || []).find((r) => r.rootPath === ALFA_POLICY_IMPORT_PREFIX);
const foldersInPolizas = polizasRoot?.identificationFolders ?? polizasRoot?.listedFolders ?? 0;

console.log('FOLDERS DETECTED:', summary.listedFolders ?? 0);
console.log('  (PÓLIZAS identification folders):', foldersInPolizas);
console.log('FILES DETECTED:', summary.processedFiles ?? 0);
console.log('IMPORTED:', summary.imported ?? 0);
console.log('MATCHED:', summary.matched ?? 0);
console.log('UNMATCHED:', summary.unmatched ?? 0);
console.log('AMBIGUOUS:', summary.ambiguous ?? 0);
console.log('SKIPPED ALREADY IMPORTED:', summary.skippedAlready ?? 0);
console.log('ERRORS:', summary.errors ?? 0);
if (summary.code === 'NO_POLICY_FOLDERS_FOUND') {
  console.log('NOTE: NO_POLICY_FOLDERS_FOUND — normal si PÓLIZAS/SINIESTROS ID están vacíos');
}
console.log('CODE:', summary.code || 'OK');
console.log('ROOTS:', JSON.stringify(summary.roots || []));

if (cfg.cronEnabled && registered && cfg.rootPath === ALFA_POLICY_IMPORT_PREFIX) {
  console.log('AUTOMATIC ALFA POLICY IMPORT: ACTIVE');
} else {
  console.log('AUTOMATIC ALFA POLICY IMPORT: INACTIVE');
  process.exitCode = 1;
}

// Dejar el proceso del script limpio (el server real mantiene el suyo)
detenerCronAlfaPolicyImport();
await mongoose.disconnect();
