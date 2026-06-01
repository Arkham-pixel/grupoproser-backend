import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

/** Cabeceras HTTP seguras. CSP desactivado: API JSON y front en otro origen. */
export function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    // Permitir <img src="http://api:3000/uploads/..."> desde el front (otro origen/puerto)
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  });
}

const loginPaths = new Set([
  '/api/auth/login',
  '/api/auth/login/2fa',
  '/api/secur-auth/login',
  '/api/secur-auth/login/2fa',
  '/api/secur-users/login'
]);

/**
 * Límite suave solo en POST de login / 2FA (por IP).
 * Desactivar en emergencia: RATE_LIMIT_DISABLED=true en .env
 */
export function loginRateLimitMiddleware() {
  const windowMs = Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS) || 15 * 60 * 1000;
  const max = Number(process.env.RATE_LIMIT_LOGIN_MAX) || 150;

  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: 'Demasiados intentos de acceso. Espere unos minutos e inténtelo de nuevo.'
    },
    skip: () => process.env.RATE_LIMIT_DISABLED === 'true'
  });

  return (req, res, next) => {
    if (process.env.RATE_LIMIT_DISABLED === 'true') {
      return next();
    }
    const p = req.path || '';
    if (req.method === 'POST' && loginPaths.has(p)) {
      return limiter(req, res, next);
    }
    next();
  };
}
