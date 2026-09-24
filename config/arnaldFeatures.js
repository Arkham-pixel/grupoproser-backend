/**
 * Interruptores de producto.
 *
 * Videoperitaje en CAT: activo por defecto.
 * IA: oculta en código (no depende de ARNALD_IA_ENABLED en Coolify).
 */

function truthy(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
}

/** Llamada de videoperitaje embebida en workspaces CAT (BBVA / Alfa). */
export function videoperitajeEnCatHabilitado() {
  if (process.env.VIDEOPERITAJE_EN_CAT === undefined || String(process.env.VIDEOPERITAJE_EN_CAT).trim() === '') {
    return true;
  }
  return truthy(process.env.VIDEOPERITAJE_EN_CAT);
}

/**
 * Al subir cada foto de una sesión vinculada a caso, copiarla a archivos
 * del caso (y así al informe vía fotosInformeDesdeCaso).
 * Por defecto ON cuando hay casoId (comportamiento deseado); se puede forzar off.
 */
export function videoperitajeAdjuntoInmediatoHabilitado() {
  if (process.env.VIDEOPERITAJE_ADJUNTO_INMEDIATO === undefined) return true;
  return truthy(process.env.VIDEOPERITAJE_ADJUNTO_INMEDIATO);
}

/** Gateway multi-proveedor Arnald IA — oculto hasta autorización explícita. */
export function arnaldIaHabilitado() {
  return false;
}
