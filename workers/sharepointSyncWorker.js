/**
 * Worker: procesa ClaimDocument pendientes (S3 → SharePoint).
 * Independiente del request HTTP de carga.
 * FASE 7: solo módulos en SHAREPOINT_SYNC_ENABLED_MODULES; anti-overlap.
 */

import {
  getSharePointSyncConfig,
  isSyncModuleEnabled,
} from '../config/sharepointSync.js';
import {
  getPendingDocuments,
  recoverStaleSyncDocuments,
} from '../services/claimDocumentService.js';
import { syncClaimDocument } from '../services/claimDocumentSyncService.js';

let cycleRunning = false;
let lastCycleAt = null;
let lastCycleSummary = null;

async function mapWithConcurrency(items, concurrency, fn) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function isSharePointSyncCycleRunning() {
  return cycleRunning;
}

export function getLastSharePointSyncCycle() {
  return lastCycleSummary
    ? { ...lastCycleSummary, lastCycleAt }
    : { lastCycleAt, running: cycleRunning };
}

/**
 * Un ciclo del worker: recover stale → claim batch → sync.
 * Si ya hay un ciclo en curso, retorna skippedOverlapping (no apila batches).
 */
export async function runSharePointSyncCycle({
  batchSize,
  concurrency,
  recoverStale = true,
} = {}) {
  if (cycleRunning) {
    const skipped = {
      skippedOverlapping: true,
      staleRecovered: 0,
      eligible: 0,
      claimed: 0,
      processed: 0,
      synced: 0,
      failed: 0,
      skipped: 0,
      durationMs: 0,
      outcomes: [],
    };
    console.log(
      JSON.stringify({
        event: 'SharePoint sync batch skipped',
        reason: 'OVERLAPPING_CYCLE',
      })
    );
    return skipped;
  }

  cycleRunning = true;
  const started = Date.now();
  const cfg = getSharePointSyncConfig();
  const size = batchSize ?? cfg.batchSize;
  const conc = concurrency ?? cfg.concurrency;

  console.log(
    JSON.stringify({
      event: 'SharePoint sync batch started',
      mode: cfg.mode,
      modules: cfg.enabledModules,
      batchSize: size,
      concurrency: conc,
    })
  );

  try {
    let staleRecovered = 0;
    if (recoverStale) {
      const recovered = await recoverStaleSyncDocuments();
      staleRecovered = recovered.length;
    }

    const pending = await getPendingDocuments({ limit: size });
    const eligible = pending.length;

    const filtered = pending.filter((doc) => isSyncModuleEnabled(doc.sourceModule));
    const moduleSkipped = eligible - filtered.length;

    const outcomes = await mapWithConcurrency(filtered, conc, async (doc) => {
      if (!isSyncModuleEnabled(doc.sourceModule)) {
        return {
          documentId: String(doc._id),
          sourceModule: doc.sourceModule,
          result: 'SKIP_MODULE_DISABLED',
        };
      }
      const r = await syncClaimDocument(doc._id);
      return {
        documentId: String(doc._id),
        sourceModule: doc.sourceModule,
        result: r.result,
        attempts: r.document?.sharepoint?.attempts,
        errorCode: r.error?.code || r.document?.sharepoint?.lastError?.code,
      };
    });

    const durationMs = Date.now() - started;
    const summary = {
      skippedOverlapping: false,
      staleRecovered,
      eligible,
      claimed: filtered.length,
      processed: outcomes.length,
      synced: outcomes.filter((o) => o.result === 'synced').length,
      failed: outcomes.filter((o) => o.result === 'failed').length,
      skipped:
        outcomes.filter((o) => String(o.result).startsWith('SKIP')).length +
        moduleSkipped,
      durationMs,
      outcomes,
    };

    lastCycleAt = new Date();
    lastCycleSummary = summary;

    console.log(
      JSON.stringify({
        event: 'SharePoint sync batch finished',
        eligible: summary.eligible,
        processed: summary.processed,
        synced: summary.synced,
        failed: summary.failed,
        skipped: summary.skipped,
        staleRecovered: summary.staleRecovered,
        durationMs: summary.durationMs,
      })
    );

    return summary;
  } finally {
    cycleRunning = false;
  }
}

export async function processSharePointSyncQueue(opts) {
  return runSharePointSyncCycle(opts);
}
