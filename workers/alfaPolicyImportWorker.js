/**
 * Worker: importación pólizas Alfa SharePoint → S3.
 * Independiente del worker ClaimDocument (S3 → SharePoint).
 */

import { getAlfaPolicyImportConfig } from '../config/alfaPolicyImport.js';
import { runAlfaPolicyImportCycle } from '../services/alfaPolicyImportService.js';

let cycleRunning = false;
let lastCycleAt = null;
let lastCycleSummary = null;

export function isAlfaPolicyImportCycleRunning() {
  return cycleRunning;
}

export function getLastAlfaPolicyImportCycle() {
  return lastCycleSummary
    ? { ...lastCycleSummary, lastCycleAt }
    : { lastCycleAt, running: cycleRunning };
}

/**
 * Un ciclo del worker. Anti-overlap.
 */
export async function runAlfaPolicyImportWorkerCycle({ batchSize } = {}) {
  if (cycleRunning) {
    const skipped = {
      skippedOverlapping: true,
      listedFolders: 0,
      processedFiles: 0,
      imported: 0,
      skippedAlready: 0,
      updated: 0,
      errors: 0,
      durationMs: 0,
    };
    console.log(
      JSON.stringify({
        event: 'Alfa policy import batch skipped',
        reason: 'OVERLAPPING_CYCLE',
      })
    );
    return skipped;
  }

  cycleRunning = true;
  const cfg = getAlfaPolicyImportConfig();
  const size = batchSize ?? cfg.batchSize;

  console.log(
    JSON.stringify({
      event: 'Alfa policy import batch started',
      batchSize: size,
      rootPath: cfg.rootPath,
    })
  );

  try {
    const summary = await runAlfaPolicyImportCycle({ batchSize: size });
    lastCycleAt = new Date();
    lastCycleSummary = summary;
    return summary;
  } finally {
    cycleRunning = false;
  }
}
