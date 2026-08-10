import SgSstCaso from '../models/SgSstCaso.js';

const ROLES_GLOBALES = new Set(['admin', 'administrador', 'soporte']);
const ROLES_DENEGADOS = new Set(['visualizador', 'puertos', 'externo']);

function usuarioDesdeReq(req) {
  return req.usuario || req.user || null;
}

function rolDesdeUsuario(usuario) {
  return String(usuario?.rol || usuario?.role || usuario?.tipoUsuario || '')
    .trim()
    .toLowerCase();
}

export function tieneAccesoGlobalSgSst(usuario) {
  return ROLES_GLOBALES.has(rolDesdeUsuario(usuario));
}

export function esRolDenegadoSgSst(usuario) {
  return Boolean(usuario?.externo) || ROLES_DENEGADOS.has(rolDesdeUsuario(usuario));
}

export function esCreadorSgSst(usuario, caso) {
  const usuarioId = String(usuario?.id || usuario?._id || '').trim();
  return Boolean(usuarioId && String(caso?.creadoPor?.id || '') === usuarioId);
}

function responderNoAutorizado(res) {
  return res.status(403).json({ message: 'No tienes permisos para acceder a SG-SST' });
}

/** Autoriza operaciones generales y bloquea roles sin acceso a SG-SST. */
export function autorizarOperacionSgSst(req, res, next) {
  const usuario = usuarioDesdeReq(req);
  if (!usuario || esRolDenegadoSgSst(usuario)) return responderNoAutorizado(res);
  return next();
}

/**
 * Autoriza el acceso a un caso activo. Los roles globales pueden acceder a
 * cualquier caso; los usuarios estándar únicamente al que crearon.
 */
export async function autorizarCasoSgSst(req, res, next) {
  try {
    const usuario = usuarioDesdeReq(req);
    if (!usuario || esRolDenegadoSgSst(usuario)) return responderNoAutorizado(res);

    const caso = await SgSstCaso.findOne({ _id: req.params.id, activo: true });
    if (!caso) return res.status(404).json({ message: 'Caso no encontrado' });

    if (!tieneAccesoGlobalSgSst(usuario) && !esCreadorSgSst(usuario, caso)) {
      return responderNoAutorizado(res);
    }

    req.sgSstCaso = caso;
    return next();
  } catch (error) {
    console.error('Error autorizando acceso SG-SST:', error);
    return res.status(500).json({ message: 'Error al verificar permisos del caso' });
  }
}
