/**
 * Interruptores de producto. Todo queda listo en código pero APAGADO
 * hasta que activemos las variables de entorno en deploy.
 *
 * Backend: VIDEOPERITAJE_EN_CAT=true | ARNALD_IA_ENABLED=true
 * Frontend: VITE_VIDEOPERITAJE_EN_CAT=true | VITE_ARNALD_IA_ENABLED=true
 */

function truthy(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
}

/** Llamada de videoperitaje embebida en workspaces CAT (BBVA / Alfa). */
export function videoperitajeEnCatHabilitado() {
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

/** Gateway multi-proveedor Arnald IA (aún no conectar en UI). */
export function arnaldIaHabilitado() {
  return truthy(process.env.ARNALD_IA_ENABLED);
}
