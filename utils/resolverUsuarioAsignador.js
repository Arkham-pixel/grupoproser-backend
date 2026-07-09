import SecurUser from '../models/SecurUser.js';

/**
 * Resuelve nombre, email y login del usuario que asigna/crea un caso.
 * Usa JWT (req.usuario), cabeceras y campos del body enviados por el frontend.
 */
export async function resolverUsuarioAsignador(req, body = {}) {
  const resultado = { nombre: null, email: '', login: '' };
  const usuarioReq = req?.usuario || {};

  const loginBody =
    body.usuarioAsignadorLogin ||
    body.loginAsignador ||
    body.login ||
    req?.headers?.['x-usuario-login'];
  const nombreBody = body.usuarioAsignadorNombre || body.nombreAsignador;

  let usuarioDB = null;

  try {
    if (usuarioReq.id) {
      usuarioDB = await SecurUser.findById(usuarioReq.id);
    } else {
      const loginBusqueda = usuarioReq.login || loginBody;
      if (loginBusqueda) {
        usuarioDB = await SecurUser.findOne({ login: String(loginBusqueda).trim() });
      }
    }
  } catch (error) {
    console.warn('⚠️ resolverUsuarioAsignador:', error.message);
  }

  if (usuarioDB) {
    resultado.nombre = usuarioDB.name || usuarioDB.login || 'Usuario';
    resultado.email = String(usuarioDB.email || '').trim();
    resultado.login = usuarioDB.login || '';
    return resultado;
  }

  if (nombreBody) {
    resultado.nombre = String(nombreBody).trim();
    resultado.login = loginBody ? String(loginBody).trim() : '';
    return resultado;
  }

  if (usuarioReq.login) {
    resultado.nombre = usuarioReq.name || usuarioReq.login;
    resultado.login = usuarioReq.login;
    return resultado;
  }

  if (loginBody) {
    resultado.nombre = String(loginBody).trim();
    resultado.login = String(loginBody).trim();
    return resultado;
  }

  resultado.nombre = body.esAsignacionAutomatica ? 'Sistema' : 'Usuario no identificado';
  return resultado;
}
