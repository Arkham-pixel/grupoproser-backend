/**
 * URLs públicas de la plataforma (Arnald + legacy).
 * Principal y respaldo Coolify comparten los mismos dominios vía DNS;
 * no dependen de la IP del servidor (52.20.220.24 / 18.119.83.81).
 */

export const PRODUCTION_FRONTEND_URL = 'https://arnald.grupoproser.com.co';
export const PRODUCTION_BACKEND_URL = 'https://arnaldbackend.grupoproser.com.co';

/** Legacy PM2 (mismo servidor front+back) */
export const LEGACY_FRONTEND_URL = 'https://aplicacion.grupoproser.com.co';
export const LEGACY_BACKEND_URL = 'https://aplicacion.grupoproser.com.co';

/** Orígenes permitidos en CORS (además de FRONTEND_URL / CORS_ORIGIN en .env). */
export const PRODUCTION_CORS_ORIGINS = [
  PRODUCTION_FRONTEND_URL,
  LEGACY_FRONTEND_URL,
];

/** IPs Coolify (referencia operativa; el tráfico entra por DNS). */
export const COOLIFY_SERVERS = Object.freeze({
  principal: '52.20.220.24',
  respaldo: '18.119.83.81',
});

function trimOrigin(url) {
  return typeof url === 'string' ? url.trim().replace(/\/+$/, '') : '';
}

/** URL del front para enlaces en correos y notificaciones. */
export function resolveFrontendUrl() {
  const fromEnv = trimOrigin(process.env.FRONTEND_URL);
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') return PRODUCTION_FRONTEND_URL;
  return 'http://localhost:5173';
}

/** URL pública del API (fallback dev → prod, proxy de archivos legacy). */
export function resolveBackendPublicUrl() {
  const fromEnv =
    trimOrigin(process.env.BASE_URL) || trimOrigin(process.env.BACKEND_URL);
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') return PRODUCTION_BACKEND_URL;
  return PRODUCTION_BACKEND_URL;
}
