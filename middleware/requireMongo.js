import mongoose from 'mongoose';

const CONNECTING = 2;

function mongoListo() {
  return mongoose.connection.readyState === 1;
}

/**
 * Evita que las rutas esperen 20–30s a Mongo cuando el pool está caído.
 * /api/health sigue pasando para que Offline First pueda sondear.
 * Si Atlas está reconectando, espera un momento antes de responder 503.
 */
export function requireMongo(req, res, next) {
  if (req.path === '/health' || req.path.startsWith('/health')) {
    return next();
  }

  if (mongoListo()) {
    return next();
  }

  if (mongoose.connection.readyState === CONNECTING) {
    const started = Date.now();
    const wait = setInterval(() => {
      if (mongoListo() || Date.now() - started > 4000) {
        clearInterval(wait);
        if (mongoListo()) return next();
        return res.status(503).json({
          success: false,
          error: 'Base de datos no disponible, reintente en unos segundos',
          code: 'MONGO_UNAVAILABLE',
        });
      }
    }, 200);
    return;
  }

  return res.status(503).json({
    success: false,
    error: 'Base de datos no disponible, reintente en unos segundos',
    code: 'MONGO_UNAVAILABLE',
  });
}
