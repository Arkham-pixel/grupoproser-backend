/**
 * Configuración del worker de sincronización ClaimDocument → SharePoint.
 */

function intEnv(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boolEnv(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

/** @returns {'test'|'pilot'|'production'} */
function resolveSyncMode() {
  const raw = String(process.env.SHAREPOINT_SYNC_MODE || 'test')
    .trim()
    .toLowerCase();
  if (raw === 'pilot' || raw === 'production') return raw;
  return 'test';
}

/**
 * Módulos habilitados para el worker automático.
 * Default piloto: solo alfa.
 * Ej: SHAREPOINT_SYNC_ENABLED_MODULES=alfa
 *     SHAREPOINT_SYNC_ENABLED_MODULES=alfa,complex
 */
function resolveEnabledModules() {
  const raw = String(process.env.SHAREPOINT_SYNC_ENABLED_MODULES || 'alfa')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return raw.length ? Object.freeze(raw) : Object.freeze(['alfa']);
}

export function getSharePointSyncConfig() {
  const mode = resolveSyncMode();
  const alfaEnabled = boolEnv('SHAREPOINT_SYNC_ALFA_ENABLED', false);
  const enabledModules = resolveEnabledModules();
  /** Compat: forceTestRoot sigue existiendo; en mode=test fuerza TEST_ARNALD. */
  const forceTestRoot =
    mode === 'test' ? true : boolEnv('SHAREPOINT_SYNC_FORCE_TEST_ROOT', mode !== 'pilot');

  return Object.freeze({
    mode,
    alfaEnabled,
    enabledModules,
    maxAttempts: intEnv('SHAREPOINT_SYNC_MAX_ATTEMPTS', 5),
    staleMinutes: intEnv('SHAREPOINT_SYNC_STALE_MINUTES', 15),
    batchSize: intEnv('SHAREPOINT_SYNC_BATCH_SIZE', 5),
    concurrency: intEnv('SHAREPOINT_SYNC_CONCURRENCY', 2),
    cronSchedule: String(process.env.SHAREPOINT_SYNC_CRON || '*/2 * * * *').trim(),
    forceTestRoot,
    cronEnabled: boolEnv('SHAREPOINT_SYNC_CRON_ENABLED', false),
    testWorkerFolder: String(process.env.SHAREPOINT_SYNC_TEST_FOLDER || 'WORKER_TEST').trim(),
  });
}

/** ¿El sourceModule está en la lista blanca del worker? */
export function isSyncModuleEnabled(sourceModule) {
  const cfg = getSharePointSyncConfig();
  const mod = String(sourceModule || '')
    .trim()
    .toLowerCase();
  if (!mod) return false;
  if (!cfg.enabledModules.includes(mod)) return false;
  // Piloto: alfa además requiere SHAREPOINT_SYNC_ALFA_ENABLED
  if (mod === 'alfa' && !cfg.alfaEnabled) return false;
  return true;
}

/**
 * Backoff tras un intento fallido (attempts ya incrementado).
 * attempt 1 → +1m, 2 → +5m, 3 → +15m, 4 → +1h, >=5 → null (sin auto).
 */
export function getNextRetryAt(attempts) {
  const n = Number(attempts) || 0;
  const delaysMs = {
    1: 1 * 60 * 1000,
    2: 5 * 60 * 1000,
    3: 15 * 60 * 1000,
    4: 60 * 60 * 1000,
  };
  const delay = delaysMs[n];
  if (!delay) return null;
  return new Date(Date.now() + delay);
}

/** ¿Este ClaimDocument puede escribir en SEGUROS ALFA/SINIESTROS/{cedula}? */
export function canUseSiniestrosPath(docOrModule) {
  const cfg = getSharePointSyncConfig();
  const module =
    typeof docOrModule === 'string'
      ? docOrModule
      : docOrModule?.sourceModule;
  return (
    cfg.mode === 'pilot' &&
    module === 'alfa' &&
    cfg.alfaEnabled === true
  );
}

/** Snapshot seguro para health (sin secretos). */
export function getSharePointWorkerHealthSnapshot() {
  const cfg = getSharePointSyncConfig();
  return {
    enabled: cfg.cronEnabled,
    mode: cfg.mode,
    modules: [...cfg.enabledModules],
    alfaEnabled: cfg.alfaEnabled,
    batchSize: cfg.batchSize,
    concurrency: cfg.concurrency,
    maxAttempts: cfg.maxAttempts,
    staleMinutes: cfg.staleMinutes,
    cron: cfg.cronSchedule,
  };
}
