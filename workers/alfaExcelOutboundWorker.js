/**
 * Worker outbox ARNALD → Excel Alfa (columnas amarillas).
 * Separado del detector inbound. Default cron OFF.
 */

import { runAlfaExcelOutboundCycle } from '../services/alfaExcelOutboundService.js';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';

let cycleRunning = false;
let lastCycleAt = null;
let lastCycleSummary = null;

export function isAlfaExcelOutboundCycleRunning() {
  return cycleRunning;
}

export function getLastAlfaExcelOutboundCycle() {
  return lastCycleSummary
    ? { ...lastCycleSummary, lastCycleAt }
    : { lastCycleAt, running: cycleRunning };
}

export async function runAlfaExcelOutboundWorkerCycle(opts = {}) {
  if (cycleRunning) {
    return { skippedOverlapping: true, outcome: 'SKIP_OVERLAPPING', durationMs: 0 };
  }

  cycleRunning = true;
  const cfg = getAlfaExcelOutboundConfig();
  const started = Date.now();
  console.log(
    JSON.stringify({
      event: 'Alfa Excel outbound cycle started',
      batchSize: opts.batchSize ?? cfg.batchSize,
    })
  );

  try {
    const summary = await runAlfaExcelOutboundCycle(opts);
    lastCycleAt = new Date();
    lastCycleSummary = { ...summary, durationMs: Date.now() - started };
    return lastCycleSummary;
  } finally {
    cycleRunning = false;
  }
}
