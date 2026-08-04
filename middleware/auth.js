import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/secrets.js';
import { actualizarActividadSesion } from './actualizarActividadSesion.js';
import { bindTranslator, SUPPORTED_LOCALES } from './locale.js';

export function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ mensaje: req.t?.('tokenNotProvided') || 'Token no proporcionado' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Intentar verificar el token normalmente
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;
    req.user = payload;

    // Si el JWT trae locale, re-enlazar traductor (localeMiddleware corre antes de auth)
    if (SUPPORTED_LOCALES.includes(payload.locale)) {
      bindTranslator(req, res);
    }
    
    // Actualizar actividad de sesión (no bloquea, solo actualiza)
    actualizarActividadSesion(req, res, next);
  } catch (error) {
    // Si el token está expirado pero es para renovación, permitir decodificarlo
    if (error.name === 'TokenExpiredError' && req.path?.includes('/refresh-token')) {
      try {
        // Decodificar sin verificar para obtener la información del usuario
        const decoded = jwt.decode(token);
        if (decoded && decoded.id) {
          req.usuario = decoded;
          req.user = decoded;
          if (SUPPORTED_LOCALES.includes(decoded.locale)) {
            bindTranslator(req, res);
          }
          next();
          return;
        }
      } catch (decodeError) {
        // Si no se puede decodificar, continuar con el error original
      }
    }
    
    return res.status(403).json({ mensaje: req.t?.('invalidOrExpiredToken') || 'Token inválido o expirado' });
  }
}
