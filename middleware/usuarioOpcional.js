import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/secrets.js';

function extraerToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  return null;
}

/** Decodifica JWT si viene en Authorization; no bloquea si falta o es inválido. */
export function poblarUsuarioOpcional(req, res, next) {
  if (req.usuario) {
    next();
    return;
  }

  const token = extraerToken(req);
  if (!token) {
    next();
    return;
  }

  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
  } catch {
    try {
      const decoded = jwt.decode(token);
      if (decoded && (decoded.id || decoded.login)) {
        req.usuario = decoded;
      }
    } catch {
      // Sin usuario autenticado
    }
  }

  next();
}
