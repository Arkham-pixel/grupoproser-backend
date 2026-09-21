/**
 * URLs públicas de la plataforma (Arnald + legacy).
 * Principal y respaldo Coolify comparten los mismos dominios vía DNS;
 * no dependen de la IP del servidor (52.20.220.24 / 18.119.83.81).
 */

import os from 'os';

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

function envUrl(...keys) {
  for (const key of keys) {
    const value = trimOrigin(process.env[key]);
    if (value) return value;
  }
  return '';
}

function isProduction() {
  return (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

/** Backend público → frontend (cuando el API infiere la URL desde el host de la petición). */
const BACKEND_HOST_TO_FRONTEND = {
  'arnaldbackend.grupoproser.com.co': PRODUCTION_FRONTEND_URL,
  'aplicacion.grupoproser.com.co': LEGACY_FRONTEND_URL,
};

function hostnameFromUrl(url) {
  if (!url) return null;
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isLocalOrigin(url) {
  return /localhost|127\.0\.0\.1/i.test(url || '');
}

/** IPv4 de esta PC en la LAN, para que el celular abra el portal sin publicar Arnald. */
export function localLanIPv4() {
  const ranked = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (!v4 || a.internal) continue;
      if (String(a.address).startsWith('169.254.')) continue;
      const n = String(name || '').toLowerCase();
      let score = 0;
      if (n.includes('wi-fi') || n.includes('wifi') || n.includes('wlan')) score += 20;
      if (String(a.address).startsWith('192.168.')) score += 10;
      if (String(a.address).startsWith('10.')) score += 5;
      if (n.includes('ethernet') || n.includes('eth')) score += 3;
      ranked.push({ ip: a.address, score });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.ip || '';
}

/**
 * Portal del asegurado (correo / WhatsApp / copiar).
 * Misma variable en local y Coolify: VIDEOPERITAJE_PUBLIC_URL, si no BASE_URL.
 */
export function resolveVideoperitajePublicUrl() {
  return (
    envUrl('VIDEOPERITAJE_PUBLIC_URL') ||
    envUrl('BASE_URL', 'BACKEND_URL') ||
    (isProduction() ? PRODUCTION_BACKEND_URL : 'http://localhost:3000')
  );
}

/**
 * URL WebRTC que usa el navegador.
 * LIVEKIT_PUBLIC_URL (celular / DNS público) o, si falta, LIVEKIT_URL.
 * En local, localhost se reescribe a la IP LAN para el celular de la misma red.
 */
export function resolveLivekitClientUrl(wsUrl) {
  const forced = envUrl('LIVEKIT_PUBLIC_URL');
  if (forced) return forced;
  const raw = String(wsUrl || envUrl('LIVEKIT_URL') || '').trim();
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (!isProduction() && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
      const lan = localLanIPv4();
      if (lan) u.hostname = lan;
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

/**
 * URL del front para enlaces en correos y notificaciones.
 * FRONTEND_URL manda siempre (localhost en local, Arnald en Coolify).
 * @param {{ requestHost?: string }} [options] - Host del request (ej. arnaldbackend…)
 */
export function resolveFrontendUrl(options = {}) {
  const fromEnv = envUrl('FRONTEND_URL');
  if (fromEnv) return fromEnv;

  const requestHost = (options.requestHost || '').split(':')[0].toLowerCase();
  if (requestHost && BACKEND_HOST_TO_FRONTEND[requestHost]) {
    return BACKEND_HOST_TO_FRONTEND[requestHost];
  }

  const backendHost =
    hostnameFromUrl(process.env.BASE_URL) ||
    hostnameFromUrl(process.env.BACKEND_URL);
  if (backendHost && BACKEND_HOST_TO_FRONTEND[backendHost]) {
    return BACKEND_HOST_TO_FRONTEND[backendHost];
  }

  return isProduction() ? PRODUCTION_FRONTEND_URL : 'http://localhost:5173';
}

/** URL pública del API. BASE_URL / BACKEND_URL mandan en local y en producción. */
export function resolveBackendPublicUrl() {
  return (
    envUrl('BASE_URL', 'BACKEND_URL') ||
    (isProduction() ? PRODUCTION_BACKEND_URL : 'http://localhost:3000')
  );
}
