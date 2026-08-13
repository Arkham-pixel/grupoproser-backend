import { checkSharePointHealth } from '../services/microsoftGraphService.js';
import { isSharePointConfigured, getSharePointConfig } from '../config/sharepoint.js';
import { getSharePointWorkerHealthSnapshot } from '../config/sharepointSync.js';
import {
  getLastSharePointSyncCycle,
  isSharePointSyncCycleRunning,
} from '../workers/sharepointSyncWorker.js';
import { isCronSharePointSyncActive } from '../services/cronSharepointSyncService.js';

/**
 * GET /api/integrations/sharepoint/health
 * Verifica token, sitio, biblioteca, lectura y (opcional) escritura bajo TEST_ARNALD.
 * Incluye snapshot del worker (sin write probe ni secretos).
 */
export async function sharepointHealth(req, res) {
  try {
    const health = await checkSharePointHealth();
    const status = health.connected ? 200 : 503;
    const workerCfg = getSharePointWorkerHealthSnapshot();
    const last = getLastSharePointSyncCycle();

    return res.status(status).json({
      connected: health.connected,
      site: health.site,
      library: health.library,
      siteId: health.siteId,
      driveId: health.driveId,
      checks: health.checks,
      configured: isSharePointConfigured(),
      writeProbe: getSharePointConfig().healthWriteProbe,
      error: health.error || undefined,
      hint: health.hint || undefined,
      architecture: {
        primaryStorage: 's3',
        metadata: 'mongodb',
        sharepointRole: 'document_replica_async',
      },
      worker: {
        enabled: workerCfg.enabled,
        cronActive: isCronSharePointSyncActive(),
        mode: workerCfg.mode,
        modules: workerCfg.modules,
        alfaEnabled: workerCfg.alfaEnabled,
        batchSize: workerCfg.batchSize,
        concurrency: workerCfg.concurrency,
        cron: workerCfg.cron,
        running: isSharePointSyncCycleRunning(),
        lastCycleAt: last.lastCycleAt || null,
        lastSynced: last.synced ?? null,
        lastFailed: last.failed ?? null,
        lastDurationMs: last.durationMs ?? null,
      },
    });
  } catch (error) {
    console.error('❌ sharepoint health:', error);
    return res.status(503).json({
      connected: false,
      site: getSharePointConfig().siteDisplayName,
      library: getSharePointConfig().libraryName,
      error: error.message || 'Error verificando SharePoint',
      worker: getSharePointWorkerHealthSnapshot(),
    });
  }
}
