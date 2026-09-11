/**
 * Cron outbound ARNALD → Excel.
 * SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED=true para activar.
 * Mantener OFF durante piloto.
 */

import cron from 'node-cron';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';
import {
  runAlfaExcelOutboundWorkerCycle,
  isAlfaExcelOutboundCycleRunning,
} from '../workers/alfaExcelOutboundWorker.js';
import { isSharePointConfigured } from '../config/sharepoint.js';

let task = null;

export function iniciarCronAlfaExcelOutbound() {
  const cfg = getAlfaExcelOutboundConfig();

  if (!cfg.cronEnabled) {
    console.log(
      '⚠️ Cron Alfa Excel outbound deshabilitado (SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED=false)'
    );
    return;
  }

  if (!isSharePointConfigured()) {
    console.log('⚠️ Cron Alfa Excel outbound omitido: MS_* no configurado');
    return;
  }

  if (task) return;

  if (!cron.validate(cfg.cronSchedule)) {
    console.error(
      `❌ SHAREPOINT_ALFA_EXCEL_OUTBOUND_CRON inválido: ${cfg.cronSchedule}. Cron no iniciado.`
    );
    return;
  }

  task = cron.schedule(
    cfg.cronSchedule,
    async () => {
      if (isAlfaExcelOutboundCycleRunning()) {
        console.log(
          JSON.stringify({
            event: 'Alfa Excel outbound cron tick skipped',
            reason: 'OVERLAPPING_CYCLE',
          })
        );
        return;
      }
      try {
        // Varias pasadas por tick para vaciar cola rápido (hasta ~100 updates/min).
        let totalClaimed = 0;
        let totalSynced = 0;
        let totalFailed = 0;
        let durationMs = 0;
        for (let round = 0; round < 4; round += 1) {
          if (isAlfaExcelOutboundCycleRunning()) break;
          const summary = await runAlfaExcelOutboundWorkerCycle();
          if (summary?.skippedOverlapping) break;
          totalClaimed += summary.claimed || 0;
          totalSynced += summary.synced || 0;
          totalFailed += summary.failed || 0;
          durationMs += summary.durationMs || 0;
          if (!(summary.claimed > 0)) break;
        }
        if (totalClaimed > 0) {
          console.log(
            `📤 Alfa Excel outbound: claimed=${totalClaimed} synced=${totalSynced} failed=${totalFailed} durationMs=${durationMs}`
          );
        }
      } catch (error) {
        console.error('❌ Error en cron Alfa Excel outbound:', error.message);
      }
    },
    { scheduled: true, timezone: 'America/Bogota' }
  );

  console.log(
    `✅ Cron Alfa Excel outbound activo (${cfg.cronSchedule}, America/Bogota)`
  );
}

export function detenerCronAlfaExcelOutbound() {
  if (task) {
    task.stop();
    task.destroy();
    task = null;
  }
}

export function isCronAlfaExcelOutboundActive() {
  return Boolean(task);
}
