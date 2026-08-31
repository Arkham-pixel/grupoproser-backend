import mongoose from 'mongoose';

/**
 * Evita que las rutas esperen 20–30s a Mongo cuando el pool está caído.
 * /api/health sigue pasando para que Offline First pueda sondear.
 */
export function requireMongo(req, res, next) {
  if (req.path === '/health' || req.path.startsWith('/health')) {
    return next();
  }

  if (mongoose.connection.readyState === 1) {
    return next();
  }

  return res.status(503).json({
    success: false,
    error: 'Base de datos no disponible, reintente en unos segundos',
    code: 'MONGO_UNAVAILABLE',
  });
}
