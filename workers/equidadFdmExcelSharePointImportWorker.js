import {
  runEquidadFdmExcelSharePointDetectCycle,
} from '../services/equidadFdmExcelSharePointService.js';

let running = false;

export function isEquidadFdmExcelSharePointCycleRunning() {
  return running;
}

export async function runEquidadFdmExcelSharePointWorkerCycle(opts = {}) {
  if (running) {
    return { outcome: 'OVERLAPPING_CYCLE', skipped: true };
  }
  running = true;
  const started = Date.now();
  try {
    const result = await runEquidadFdmExcelSharePointDetectCycle(opts);
    return { ...result, durationMs: Date.now() - started };
  } finally {
    running = false;
  }
}
