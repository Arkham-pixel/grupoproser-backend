/**
 * Cron: detección/preview Excel Alfa SharePoint.
 * SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED=true para activar.
 * Nunca llama /execute.
 */

import cron from 'node-cron';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import {
  runAlfaExcelSharePointWorkerCycle,
  isAlfaExcelSharePointCycleRunning,
} from '../workers/alfaExcelSharePointImportWorker.js';
import { isSharePointConfigured } from '../config/sharepoint.js';

let task = null;

export function iniciarCronAlfaExcelSharePointImport() {
  const cfg = getAlfaExcelSharePointImportConfig();

  if (!cfg.cronEnabled) {
    console.log(
      '⚠️ Cron Alfa Excel SharePoint deshabilitado (SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED=false)'
    );
    return;
  }

  if (!isSharePointConfigured()) {
    console.log('⚠️ Cron Alfa Excel SharePoint omitido: MS_* no configurado');
    return;
  }

  if (task) return;

  if (!cron.validate(cfg.cronSchedule)) {
    console.error(
      `❌ SHAREPOINT_ALFA_EXCEL_IMPORT_CRON inválido: ${cfg.cronSchedule}. Cron no iniciado.`
    );
    return;
  }

  task = cron.schedule(
    cfg.cronSchedule,
    async () => {
      if (isAlfaExcelSharePointCycleRunning()) {
        console.log(
          JSON.stringify({
            event: 'Alfa Excel SharePoint cron tick skipped',
            reason: 'OVERLAPPING_CYCLE',
          })
        );
        return;
      }
      try {
        const summary = await runAlfaExcelSharePointWorkerCycle();
        if (summary.outcome && summary.outcome !== 'SKIP_ALREADY_PREVIEWED') {
          console.log(
            `📊 Alfa Excel SP: outcome=${summary.outcome} status=${summary.status} hasChanges=${summary.hasChanges} durationMs=${summary.durationMs}`
          );
        }
      } catch (error) {
        console.error('❌ Error en cron Alfa Excel SharePoint:', error.message);
      }
    },
    { scheduled: true, timezone: 'America/Bogota' }
  );

  console.log(
    `✅ Cron Alfa Excel SharePoint activo (${cfg.cronSchedule}, America/Bogota) — solo preview`
  );
}

export function detenerCronAlfaExcelSharePointImport() {
  if (task) {
    task.stop();
    task.destroy();
    task = null;
  }
}

export function isCronAlfaExcelSharePointImportActive() {
  return Boolean(task);
}
