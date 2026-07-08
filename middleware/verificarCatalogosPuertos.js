import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/secrets.js';

export function rolPuedeCatalogosPuertos(rol) {
  const r = String(rol || '')
    .trim()
    .toLowerCase();
  return r === 'admin' || r === 'administrador' || r === 'soporte' || r === 'puertos';
}

export function usuarioAutorizadoCatalogosPuertos(usuario = {}) {
  return rolPuedeCatalogosPuertos(usuario.rol);
}

/**
 * Admin, soporte o usuarios con rol Puertos.
 */
export function verificarCatalogosPuertos(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token no proporcionado' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    const autorizado = usuarioAutorizadoCatalogosPuertos({
      rol: decoded.rol ?? decoded.role ?? decoded.tipoUsuario,
    });

    if (!autorizado) {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado. No tiene permiso para administrar catálogos de Puertos.',
      });
    }

    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Token inválido o expirado',
      error: error.message,
    });
  }
}
