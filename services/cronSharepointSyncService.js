/**
 * Cron ARNALD: cola ClaimDocument → SharePoint (mismo patrón que email outbox).
 * Deshabilitado por defecto hasta activar SHAREPOINT_SYNC_CRON_ENABLED=true.
 * FASE 7: anti-overlap; solo módulos en SHAREPOINT_SYNC_ENABLED_MODULES.
 */

import cron from 'node-cron';
import { getSharePointSyncConfig } from '../config/sharepointSync.js';
import {
  runSharePointSyncCycle,
  isSharePointSyncCycleRunning,
} from '../workers/sharepointSyncWorker.js';
import { isSharePointConfigured } from '../config/sharepoint.js';

let task = null;

export function iniciarCronSharePointSync() {
  const cfg = getSharePointSyncConfig();

  if (!cfg.cronEnabled) {
    console.log(
      '⚠️ Cron SharePoint sync deshabilitado (SHAREPOINT_SYNC_CRON_ENABLED=false)'
    );
    return;
  }

  if (!isSharePointConfigured()) {
    console.log('⚠️ Cron SharePoint sync omitido: MS_* no configurado');
    return;
  }

  if (task) return;

  if (!cron.validate(cfg.cronSchedule)) {
    console.error(
      `❌ SHAREPOINT_SYNC_CRON inválido: ${cfg.cronSchedule}. Cron no iniciado.`
    );
    return;
  }

  task = cron.schedule(
    cfg.cronSchedule,
    async () => {
      if (isSharePointSyncCycleRunning()) {
        console.log(
          JSON.stringify({
            event: 'SharePoint sync cron tick skipped',
            reason: 'OVERLAPPING_CYCLE',
          })
        );
        return;
      }
      try {
        const summary = await runSharePointSyncCycle();
        if (
          summary.claimed > 0 ||
          summary.staleRecovered > 0 ||
          summary.skippedOverlapping
        ) {
          console.log(
            `📎 SharePoint sync: eligible=${summary.eligible} processed=${summary.processed} synced=${summary.synced} failed=${summary.failed} skipped=${summary.skipped} durationMs=${summary.durationMs}`
          );
        }
      } catch (error) {
        console.error('❌ Error en cron SharePoint sync:', error.message);
      }
    },
    { scheduled: true, timezone: 'America/Bogota' }
  );

  console.log(
    `✅ Cron SharePoint sync activo (${cfg.cronSchedule}, America/Bogota, mode=${cfg.mode}, modules=${cfg.enabledModules.join(',')}, batch=${cfg.batchSize}, concurrency=${cfg.concurrency})`
  );
}

export function detenerCronSharePointSync() {
  if (task) {
    task.stop();
    task.destroy();
    task = null;
  }
}

export function isCronSharePointSyncActive() {
  return Boolean(task);
}
