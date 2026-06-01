import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/secrets.js';
import { usuarioAutorizadoCatalogosExpress } from '../config/expressCatalogosPermitidos.js';

/**
 * Admin, soporte o usuarios autorizados (p. ej. catálogo Express dedicado).
 */
export function verificarCatalogosExpress(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token no proporcionado' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    const autorizado = usuarioAutorizadoCatalogosExpress({
      cedula: decoded.cedula ?? decoded.documento ?? decoded.codiCedula,
      login: decoded.login ?? decoded.usuario ?? decoded.user,
      email: decoded.email ?? decoded.correo ?? decoded.correoElectronico,
      rol: decoded.rol ?? decoded.role ?? decoded.tipoUsuario,
    });

    if (!autorizado) {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado. No tiene permiso para administrar catálogos Express.',
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
