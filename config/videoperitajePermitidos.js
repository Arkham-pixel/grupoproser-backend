/**
 * Módulo de videoperitaje en prueba: solo estos logins/cédulas usan la API autenticada.
 * Debe coincidir con frontend/src/config/videoperitajePermitidos.js
 * El portal del asegurado (/public/:token) no pasa por este filtro.
 */
export const LOGINS_VIDEOPERITAJE = ['1065012991'];

export function usuarioPuedeVideoperitaje(user) {
  const ids = [
    user?.login,
    user?.usuario,
    user?.cedula,
    user?.documento,
    user?.codiCedula,
  ].map((v) => String(v || '').trim());
  return ids.some((id) => id && LOGINS_VIDEOPERITAJE.includes(id));
}

export function restringirVideoperitaje(req, res, next) {
  const user = req.usuario || req.user;
  if (!usuarioPuedeVideoperitaje(user)) {
    return res.status(403).json({
      error: 'Módulo en prueba. Acceso restringido.',
    });
  }
  return next();
}
