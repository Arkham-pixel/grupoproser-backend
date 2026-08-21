/**
 * Watchdog SharePoint: verifica token + site/drive periódicamente.
 * Si Graph falla, reinicia el cliente MSAL y reintenta; no tumba el proceso.
 */

import cron from 'node-cron';
import { isSharePointConfigured } from '../config/sharepoint.js';
import {
  checkSharePointHealth,
  resetMicrosoftGraphClient,
} from './microsoftGraphService.js';

let task = null;
let lastOkAt = null;
let lastError = null;
let consecutiveFailures = 0;

export function getSharePointWatchdogStatus() {
  return {
    active: Boolean(task),
    lastOkAt,
    lastError,
    consecutiveFailures,
  };
}

export async function runSharePointWatchdogProbe() {
  if (!isSharePointConfigured()) {
    return { ok: false, skipped: true, reason: 'NOT_CONFIGURED' };
  }

  try {
    // Health sin write probe agresivo en watchdog (usa env; no forzamos write)
    const health = await checkSharePointHealth();
    if (!health.connected || !health.checks?.token || !health.checks?.read) {
      throw new Error(health.error || 'SharePoint health connected=false');
    }
    consecutiveFailures = 0;
    lastError = null;
    lastOkAt = new Date().toISOString();
    console.log(
      JSON.stringify({
        event: 'SHAREPOINT_WATCHDOG_OK',
        at: lastOkAt,
        siteId: Boolean(health.siteId),
        driveId: Boolean(health.driveId),
      })
    );
    return { ok: true, health };
  } catch (error) {
    consecutiveFailures += 1;
    lastError = error.message || String(error);
    console.error(
      JSON.stringify({
        event: 'SHAREPOINT_WATCHDOG_FAIL',
        at: new Date().toISOString(),
        consecutiveFailures,
        message: lastError.slice(0, 300),
      })
    );
    // Recuperación: reset MSAL y un reintento inmediato
    resetMicrosoftGraphClient();
    try {
      const health = await checkSharePointHealth();
      if (health.connected && health.checks?.token) {
        consecutiveFailures = 0;
        lastError = null;
        lastOkAt = new Date().toISOString();
        console.log(
          JSON.stringify({
            event: 'SHAREPOINT_WATCHDOG_RECOVERED',
            at: lastOkAt,
          })
        );
        return { ok: true, recovered: true, health };
      }
    } catch (retryErr) {
      lastError = retryErr.message || String(retryErr);
    }
    return { ok: false, error: lastError, consecutiveFailures };
  }
}

/**
 * Cron cada 5 min (America/Bogota). Primer probe a los ~15s del arranque.
 */
export function iniciarSharePointWatchdog() {
  if (task) return;

  if (!isSharePointConfigured()) {
    console.log('⚠️ SharePoint watchdog omitido: MS_* no configurado o inválido');
    return;
  }

  const schedule = String(process.env.SHAREPOINT_WATCHDOG_CRON || '*/5 * * * *').trim();
  if (!cron.validate(schedule)) {
    console.error(`❌ SHAREPOINT_WATCHDOG_CRON inválido: ${schedule}`);
    return;
  }

  task = cron.schedule(
    schedule,
    async () => {
      await runSharePointWatchdogProbe();
    },
    { scheduled: true, timezone: 'America/Bogota' }
  );

  console.log(`✅ SharePoint watchdog activo (${schedule}, America/Bogota)`);

  setTimeout(() => {
    runSharePointWatchdogProbe().catch(() => {});
  }, 15_000);
}

export function detenerSharePointWatchdog() {
  if (task) {
    task.stop();
    task.destroy();
    task = null;
  }
}
