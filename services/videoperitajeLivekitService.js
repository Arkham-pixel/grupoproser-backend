/**
 * Firma tokens LiveKit. Si no hay claves, el módulo sigue (fotos/autoinspección)
 * y la videollamada avisa que falta el SFU.
 */

import { resolveLivekitClientUrl } from '../config/platformUrls.js';

let AccessTokenCtor = null;
let RoomServiceClientCtor = null;
let livekitLoadAttempted = false;

async function loadLivekitSdk() {
  if (livekitLoadAttempted) return { AccessTokenCtor, RoomServiceClientCtor };
  livekitLoadAttempted = true;
  try {
    const mod = await import('livekit-server-sdk');
    AccessTokenCtor = mod.AccessToken;
    RoomServiceClientCtor = mod.RoomServiceClient;
  } catch (err) {
    console.warn('⚠️ livekit-server-sdk no disponible:', err.message);
    AccessTokenCtor = null;
    RoomServiceClientCtor = null;
  }
  return { AccessTokenCtor, RoomServiceClientCtor };
}

function livekitHttpUrl(wsUrl) {
  return String(wsUrl || '')
    .replace(/^wss:/i, 'https:')
    .replace(/^ws:/i, 'http:');
}

export function livekitConfig() {
  const url = String(process.env.LIVEKIT_URL || '').trim();
  const apiKey = String(process.env.LIVEKIT_API_KEY || '').trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || '').trim();
  return {
    url,
    apiKey,
    apiSecret,
    configured: Boolean(url && apiKey && apiSecret),
  };
}

export function nombreSalaLivekit(sesionId) {
  return `vp-${String(sesionId)}`;
}

export async function crearTokenLivekit({
  room,
  identity,
  name,
  canPublish = true,
  canSubscribe = true,
  ttl = '4h',
}) {
  const cfg = livekitConfig();
  if (!cfg.configured) {
    const error = new Error('LiveKit no está configurado (LIVEKIT_URL / API_KEY / API_SECRET).');
    error.code = 'LIVEKIT_NOT_CONFIGURED';
    throw error;
  }
  const { AccessTokenCtor: Token } = await loadLivekitSdk();
  if (!Token) {
    const error = new Error('No se pudo cargar livekit-server-sdk.');
    error.code = 'LIVEKIT_SDK_MISSING';
    throw error;
  }
  const at = new Token(cfg.apiKey, cfg.apiSecret, {
    identity: String(identity || `user-${Date.now()}`),
    name: String(name || identity || 'participante'),
    ttl,
  });
  at.addGrant({
    roomJoin: true,
    room: String(room),
    canPublish,
    canSubscribe,
    canPublishData: true,
  });
  const jwt = await at.toJwt();
  const url = resolveLivekitClientUrl(cfg.url);
  if (!url) {
    const error = new Error(
      'LiveKit no tiene URL pública. En Coolify use LIVEKIT_PUBLIC_URL=wss://… (no localhost).'
    );
    error.code = 'LIVEKIT_NOT_CONFIGURED';
    throw error;
  }
  return { token: jwt, url, room };
}

/** Cierra la sala para que el cliente también salga de la llamada. */
export async function cerrarSalaLivekit(roomName) {
  const cfg = livekitConfig();
  const room = String(roomName || '').trim();
  if (!cfg.configured || !room) return { ok: false };
  try {
    const { RoomServiceClientCtor: Client } = await loadLivekitSdk();
    if (!Client) return { ok: false };
    const svc = new Client(livekitHttpUrl(cfg.url), cfg.apiKey, cfg.apiSecret);
    await svc.deleteRoom(room);
    return { ok: true };
  } catch (err) {
    console.warn('⚠️ no se pudo cerrar sala LiveKit:', err.message);
    return { ok: false, error: err.message };
  }
}
