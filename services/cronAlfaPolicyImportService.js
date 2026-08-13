/**
 * Cron importación pólizas Alfa (SharePoint → ARNALD).
 * Deshabilitado por defecto: SHAREPOINT_ALFA_POLICY_IMPORT_ENABLED=false.
 */

import cron from 'node-cron';
import { getAlfaPolicyImportConfig } from '../config/alfaPolicyImport.js';
import {
  runAlfaPolicyImportWorkerCycle,
  isAlfaPolicyImportCycleRunning,
} from '../workers/alfaPolicyImportWorker.js';
import { isSharePointConfigured } from '../config/sharepoint.js';

let task = null;

export function iniciarCronAlfaPolicyImport() {
  const cfg = getAlfaPolicyImportConfig();

  if (!cfg.cronEnabled) {
    console.log(
      '⚠️ Cron Alfa policy import deshabilitado (SHAREPOINT_ALFA_POLICY_IMPORT_ENABLED=false)'
    );
    return;
  }

  if (!isSharePointConfigured()) {
    console.log('⚠️ Cron Alfa policy import omitido: MS_* no configurado');
    return;
  }

  if (task) return;

  if (!cron.validate(cfg.cronSchedule)) {
    console.error(
      `❌ SHAREPOINT_ALFA_POLICY_IMPORT_CRON inválido: ${cfg.cronSchedule}. Cron no iniciado.`
    );
    return;
  }

  task = cron.schedule(
    cfg.cronSchedule,
    async () => {
      if (isAlfaPolicyImportCycleRunning()) {
        console.log(
          JSON.stringify({
            event: 'Alfa policy import cron tick skipped',
            reason: 'OVERLAPPING_CYCLE',
          })
        );
        return;
      }
      try {
        const summary = await runAlfaPolicyImportWorkerCycle();
        console.log(
          JSON.stringify({
            event: 'Alfa policy import cron cycle',
            enabled: true,
            cron: cfg.cronSchedule,
            sourcePath: cfg.rootPath,
            code: summary.code || null,
            foldersDetected: summary.listedFolders ?? 0,
            filesDetected: summary.processedFiles ?? 0,
            imported: summary.imported ?? 0,
            matched: summary.matched ?? 0,
            unmatched: summary.unmatched ?? 0,
            ambiguous: summary.ambiguous ?? 0,
            skippedAlreadyImported: summary.skippedAlready ?? 0,
            updated: summary.updated ?? 0,
            errors: summary.errors ?? 0,
            durationMs: summary.durationMs ?? 0,
          })
        );
      } catch (error) {
        console.error('❌ Error en cron Alfa policy import:', error.message);
      }
    },
    { scheduled: true, timezone: 'America/Bogota' }
  );

  console.log(
    `✅ Cron Alfa policy import activo (${cfg.cronSchedule}, America/Bogota, batch=${cfg.batchSize})`
  );
}

export function detenerCronAlfaPolicyImport() {
  if (task) {
    task.stop();
    task.destroy();
    task = null;
  }
}

export function isCronAlfaPolicyImportActive() {
  return Boolean(task);
}
