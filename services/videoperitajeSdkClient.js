/**
 * Cliente HTTP → Videoperitaje SDK (Coolify).
 * Preferido sobre Postgres directo cuando VIDEOPERITAJE_SDK_URL está definido.
 */
function truthy(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
}

export function videoperitajeSdkConfigurado() {
  const url = String(process.env.VIDEOPERITAJE_SDK_URL || '').trim();
  const key = String(process.env.VIDEOPERITAJE_SDK_KEY || process.env.VIDEOPERITAJE_API_KEY || '').trim();
  return Boolean(url && key);
}

function baseUrl() {
  return String(process.env.VIDEOPERITAJE_SDK_URL || '')
    .trim()
    .replace(/\/+$/, '');
}

function apiKey() {
  return String(process.env.VIDEOPERITAJE_SDK_KEY || process.env.VIDEOPERITAJE_API_KEY || '').trim();
}

async function sdkFetch(path, { method = 'GET', body } = {}) {
  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey(),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `SDK HTTP ${res.status}`);
    err.status = res.status;
    err.code = data.code || 'VIDEOPERITAJE_SDK_ERROR';
    err.payload = data;
    throw err;
  }
  return data;
}

export async function sdkHealth() {
  const url = `${baseUrl()}/health`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function sdkVerificarCupo(modulo) {
  const qs = new URLSearchParams({ modulo: String(modulo || '') });
  return sdkFetch(`/v1/cupo?${qs}`);
}

export async function sdkRegistrarSesion(payload) {
  return sdkFetch('/v1/sesiones', { method: 'POST', body: payload });
}

export async function sdkActualizarSesion(mongoSesionId, patch) {
  return sdkFetch(`/v1/sesiones/${encodeURIComponent(mongoSesionId)}`, {
    method: 'PATCH',
    body: patch,
  });
}

export async function sdkEventoSesion(mongoSesionId, evento) {
  return sdkFetch(`/v1/sesiones/${encodeURIComponent(mongoSesionId)}/eventos`, {
    method: 'POST',
    body: evento,
  });
}

export async function sdkPuedeIniciarLlamada(mongoSesionId) {
  return sdkFetch(`/v1/sesiones/${encodeURIComponent(mongoSesionId)}/puede-iniciar`);
}

export { truthy as envTruthy };
