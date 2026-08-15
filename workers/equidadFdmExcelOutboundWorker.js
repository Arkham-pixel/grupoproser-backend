import { runEquidadFdmExcelOutboundCycle } from '../services/equidadFdmExcelOutboundService.js';

let running = false;

export function isEquidadFdmExcelOutboundCycleRunning() {
  return running;
}

export async function runEquidadFdmExcelOutboundWorkerCycle(opts = {}) {
  if (running) {
    return { skipped: true, reason: 'OVERLAPPING_CYCLE' };
  }
  running = true;
  try {
    return await runEquidadFdmExcelOutboundCycle(opts);
  } finally {
    running = false;
  }
}
