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
        const summary = await runAlfaExcelOutboundWorkerCycle();
        if (summary.claimed > 0) {
          console.log(
            `📤 Alfa Excel outbound: claimed=${summary.claimed} synced=${summary.synced} failed=${summary.failed} durationMs=${summary.durationMs}`
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
