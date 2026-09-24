/**
 * Módulo de videoperitaje: abierto a todos los usuarios autenticados.
 * Admin (vaciar papelera / cupo): LOGINS_VIDEOPERITAJE_ADMIN o rol admin.
 * Debe coincidir con frontend/src/config/videoperitajePermitidos.js
 * El portal del asegurado (/public/:token) no pasa por este filtro.
 */

function parseLogins(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Acceso al módulo: siempre abierto (no depende de env restrictivo en Coolify). */
export const LOGINS_VIDEOPERITAJE = ['*'];

/** Solo estos logins (o rol admin) pueden vaciar la papelera y ver el cupo. */
export const LOGINS_VIDEOPERITAJE_ADMIN = parseLogins(
  process.env.LOGINS_VIDEOPERITAJE_ADMIN || '1065012991'
);

export function accesoVideoperitajeAbierto() {
  return true;
}

function idsDeUsuario(user) {
  return [
    user?.login,
    user?.usuario,
    user?.cedula,
    user?.documento,
    user?.codiCedula,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

export function usuarioPuedeVideoperitaje(user) {
  return Boolean(user);
}

export function usuarioEsAdminVideoperitaje(user) {
  const ids = idsDeUsuario(user);
  if (ids.some((id) => LOGINS_VIDEOPERITAJE_ADMIN.includes(id))) return true;
  const r = String(user?.rol || user?.role || '').trim().toLowerCase();
  return r === 'admin' || r === 'administrador' || r === 'administrator';
}

/** Filtro Mongo: sesiones propias del ajustador (userId o login/cédula). */
export function filtroSesionesPropias(user) {
  const u = user || {};
  const id = String(u.id || u._id || '').trim();
  const or = [];
  if (id) or.push({ peritoUserId: id });
  for (const login of idsDeUsuario(u)) {
    or.push({ peritoLogin: login });
  }
  if (!or.length) return { _id: null };
  return { $or: or };
}

export function sesionPerteneceAUsuario(sesion, user) {
  if (!sesion || !user) return false;
  const id = String(user.id || user._id || '').trim();
  const logins = new Set(idsDeUsuario(user));
  if (id && String(sesion.peritoUserId || '') === id) return true;
  if (logins.has(String(sesion.peritoLogin || '').trim())) return true;
  return false;
}

export function restringirVideoperitaje(req, res, next) {
  const user = req.usuario || req.user;
  if (!usuarioPuedeVideoperitaje(user)) {
    return res.status(403).json({
      error: 'Sin acceso a videoperitaje.',
    });
  }
  return next();
}
