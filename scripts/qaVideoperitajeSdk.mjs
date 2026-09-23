/**
 * QA smoke: Videoperitaje SDK (Grupo Proser)
 * Uso: node scripts/qaVideoperitajeSdk.mjs
 */
import 'dotenv/config';

const BASE = String(process.env.VIDEOPERITAJE_SDK_URL || 'https://videosdk.binaria.online').replace(
  /\/+$/,
  ''
);
const KEY = String(process.env.VIDEOPERITAJE_SDK_KEY || process.env.API_KEY || '').trim();

const results = [];

async function step(name, fn) {
  try {
    const data = await fn();
    results.push({ name, ok: true, data });
    console.log(`✅ ${name}`);
    return data;
  } catch (err) {
    results.push({ name, ok: false, error: err.message, detail: err.detail });
    console.log(`❌ ${name}: ${err.message}`);
    return null;
  }
}

async function req(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['x-api-key'] = KEY;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.detail = data;
    throw err;
  }
  return data;
}

console.log(`QA SDK → ${BASE}`);
if (!KEY) console.warn('⚠️  Sin API_KEY / VIDEOPERITAJE_SDK_KEY');

await step('health', () => req('/health', { auth: false }));
await step('cupo grupoproser (independiente)', () => req('/v1/cupo?modulo=independiente'));
await step('listar compañías', () => req('/v1/companias'));

const mongoId = `qa-test-${Date.now()}`;
const ahora = new Date();
const programada = new Date(ahora.getTime() + 2 * 60 * 1000); // +2 min

const creada = await step('crear sesión programada Grupo Proser', () =>
  req('/v1/sesiones', {
    method: 'POST',
    body: {
      mongo_sesion_id: mongoId,
      modulo: 'independiente',
      expediente: 'QA-GRUPOPROSER-001',
      estado: 'pendiente',
      programada_at: programada.toISOString(),
      auditor: { login: '1065012991', nombre: 'QA Auditor' },
      asegurado: {
        nombre: 'Asegurado QA',
        telefono: '3000000000',
        correo: 'qa@example.com',
      },
    },
  })
);

await step('puede-iniciar (muy temprano esperado si ventana 15min)', async () => {
  const r = await req(`/v1/sesiones/${mongoId}/puede-iniciar`);
  return r;
});

await step('connect evento', () =>
  req(`/v1/sesiones/${mongoId}/eventos`, {
    method: 'POST',
    body: { tipo: 'connect', rol: 'auditor', actor_login: '1065012991' },
  })
);

await step('cerrar sesión', () =>
  req(`/v1/sesiones/${mongoId}`, {
    method: 'PATCH',
    body: { estado: 'finalizada', finalizada_at: new Date().toISOString(), duracion_segundos: 30 },
  })
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\nResumen: ${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
