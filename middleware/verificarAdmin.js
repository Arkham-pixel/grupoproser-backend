import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/secrets.js';

/** Solo rol administrativo (admin / administrador). No incluye soporte. */
export function verificarAdmin(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token no proporcionado' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    const rolRaw = decoded.rol || decoded.role || decoded.tipoUsuario || '';
    const rol = String(rolRaw).trim().toLowerCase();
    const esAdmin = rol === 'admin' || rol === 'administrador';

    if (!esAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado. Se requieren permisos de administrador.',
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
