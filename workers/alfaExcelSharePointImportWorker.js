/**
 * Worker: detección Excel Alfa SharePoint → preview.
 * Nunca ejecuta /execute.
 */

import { runAlfaExcelSharePointDetectCycle } from '../services/alfaExcelSharePointImportService.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';

let cycleRunning = false;
let lastCycleAt = null;
let lastCycleSummary = null;

export function isAlfaExcelSharePointCycleRunning() {
  return cycleRunning;
}

export function getLastAlfaExcelSharePointCycle() {
  return lastCycleSummary
    ? { ...lastCycleSummary, lastCycleAt }
    : { lastCycleAt, running: cycleRunning };
}

export async function runAlfaExcelSharePointWorkerCycle(opts = {}) {
  if (cycleRunning) {
    const skipped = {
      skippedOverlapping: true,
      outcome: 'SKIP_OVERLAPPING',
      durationMs: 0,
    };
    return skipped;
  }

  cycleRunning = true;
  const cfg = getAlfaExcelSharePointImportConfig();
  console.log(
    JSON.stringify({
      event: 'Alfa Excel SharePoint detect started',
      rootPath: cfg.rootPath,
      fileName: cfg.fileName || null,
    })
  );

  try {
    const summary = await runAlfaExcelSharePointDetectCycle(opts);
    lastCycleAt = new Date();
    lastCycleSummary = summary;
    return summary;
  } finally {
    cycleRunning = false;
  }
}
