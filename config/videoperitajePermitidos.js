/**
 * Módulo de videoperitaje: acceso abierto a usuarios autenticados + admin
 * (ve todo el historial / vacía papelera / ve cupo).
 * Debe coincidir con frontend/src/config/videoperitajePermitidos.js
 * El portal del asegurado (/public/:token) no pasa por este filtro.
 *
 * LOGINS_VIDEOPERITAJE=* | all | open  → todos los autenticados
 * (por defecto ahora: abierto)
 */

function parseLogins(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const rawAllow = process.env.LOGINS_VIDEOPERITAJE;
export const LOGINS_VIDEOPERITAJE = parseLogins(
  rawAllow == null || String(rawAllow).trim() === '' ? '*' : rawAllow
);

/** Solo estos logins (o rol admin) ven todo el historial y pueden vaciar la papelera. */
export const LOGINS_VIDEOPERITAJE_ADMIN = parseLogins(
  process.env.LOGINS_VIDEOPERITAJE_ADMIN || '1065012991'
);

export function accesoVideoperitajeAbierto() {
  if (LOGINS_VIDEOPERITAJE.length === 0) return true;
  return LOGINS_VIDEOPERITAJE.some((id) =>
    ['*', 'all', 'open', 'todos'].includes(String(id).toLowerCase())
  );
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
  if (accesoVideoperitajeAbierto()) return Boolean(user);
  const ids = idsDeUsuario(user);
  return ids.some((id) => LOGINS_VIDEOPERITAJE.includes(id));
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
