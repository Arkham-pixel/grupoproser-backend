/**
 * Progreso compartido del envío ARNALD → Excel (visible para TI + Daniela).
 * En memoria del proceso Node; todos los clientes lo leen vía /control-seguimiento/status.
 */

let progress = {
  running: false,
  startedAt: null,
  finishedAt: null,
  startedByLogin: '',
  startedByName: '',
  peakTotal: 0,
  left: 0,
  done: 0,
  synced: 0,
  failed: 0,
  roundsRun: 0,
  pct: 0,
  label: '',
  lastError: null,
};

function clampPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

export function getAlfaExcelOutboundProgress() {
  return { ...progress };
}

export function startAlfaExcelOutboundProgress({
  startedByLogin = '',
  startedByName = '',
  peakTotal = 0,
} = {}) {
  const peak = Math.max(0, Number(peakTotal) || 0);
  progress = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    startedByLogin: String(startedByLogin || ''),
    startedByName: String(startedByName || ''),
    peakTotal: peak,
    left: peak,
    done: 0,
    synced: 0,
    failed: 0,
    roundsRun: 0,
    pct: peak > 0 ? 0 : 1,
    label: peak > 0 ? 'Preparando cola ARNALD → Excel…' : 'Armando cola de envío…',
    lastError: null,
  };
  return getAlfaExcelOutboundProgress();
}

export function updateAlfaExcelOutboundProgress(patch = {}) {
  if (!progress.running && patch.running !== true) {
    // permitir actualizar left/peak aunque ya terminó (últimos segundos)
  }
  const next = { ...progress, ...patch };
  if (patch.peakTotal != null || patch.left != null) {
    const peak = Math.max(
      Number(next.peakTotal) || 0,
      Number(next.left) || 0,
      Number(progress.peakTotal) || 0
    );
    next.peakTotal = peak;
    const left = Math.max(0, Number(next.left) || 0);
    next.left = left;
    next.done = Math.max(0, peak - left);
    next.pct =
      peak > 0
        ? clampPct((next.done / peak) * 100)
        : next.running
          ? Math.min(99, Number(progress.pct) || 5)
          : 100;
  }
  if (patch.pct != null) next.pct = clampPct(patch.pct);
  progress = next;
  return getAlfaExcelOutboundProgress();
}

export function finishAlfaExcelOutboundProgress({
  left = 0,
  synced = 0,
  failed = 0,
  roundsRun = 0,
  error = null,
} = {}) {
  const peak = Math.max(Number(progress.peakTotal) || 0, Number(left) || 0, Number(synced) || 0);
  const leftN = Math.max(0, Number(left) || 0);
  const done = Math.max(0, peak - leftN);
  progress = {
    ...progress,
    running: false,
    finishedAt: new Date().toISOString(),
    peakTotal: peak,
    left: leftN,
    done,
    synced: Number(synced) || 0,
    failed: Number(failed) || 0,
    roundsRun: Number(roundsRun) || 0,
    pct: leftN > 0 ? clampPct((done / Math.max(peak, 1)) * 100) : 100,
    label:
      error
        ? `Error en envío: ${error}`
        : leftN > 0
          ? `Envío parcial: quedan ${leftN} en cola — pulse Enviar de nuevo`
          : 'Envío a Excel completado',
    lastError: error ? String(error) : null,
  };
  return getAlfaExcelOutboundProgress();
}

/** Libera progreso stuck (p. ej. deploy a mitad de flush o Graph colgado). */
export function clearStuckAlfaExcelOutboundProgress({ maxAgeMs = 20 * 60 * 1000 } = {}) {
  if (!progress.running) return { cleared: false, reason: 'not_running' };
  const startedMs = progress.startedAt ? new Date(progress.startedAt).getTime() : 0;
  if (!startedMs || Date.now() - startedMs < maxAgeMs) {
    return { cleared: false, reason: 'too_recent', ageMs: startedMs ? Date.now() - startedMs : null };
  }
  finishAlfaExcelOutboundProgress({
    left: progress.left || 0,
    synced: progress.synced || 0,
    failed: progress.failed || 0,
    roundsRun: progress.roundsRun || 0,
    error: `Envío liberado: llevaba más de ${Math.round(maxAgeMs / 60000)} min`,
  });
  return { cleared: true, progress: getAlfaExcelOutboundProgress() };
}
