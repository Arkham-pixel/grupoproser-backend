/**
 * Cierra en SDK (y PG si está habilitado) solo sesiones YA cerradas en Mongo
 * (o huérfanas de prueba) que aún figuren abiertas/concurrentes.
 * NO toca sesiones Mongo pendiente / en_proceso.
 *
 *   node scripts/cerrarFantasmasVideoperitajePostgres.js
 *   node scripts/cerrarFantasmasVideoperitajePostgres.js --dry-run
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import VideoperitajeSesion from '../models/VideoperitajeSesion.js';
import { cerrarSesionPostgres } from '../services/videoperitajePgService.js';
import {
  videoperitajeSdkConfigurado,
  sdkVerificarCupo,
} from '../services/videoperitajeSdkClient.js';
import {
  videoperitajePgConfigurado,
  videoperitajePgQuery,
} from '../config/videoperitajePostgres.js';

const DRY = process.argv.includes('--dry-run');
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function isLiveSdkRow(r) {
  return (
    ['pendiente', 'en_proceso'].includes(String(r.estado || '')) ||
    r.finalizada_at == null
  );
}

async function listarSdkAbiertas() {
  if (!videoperitajeSdkConfigurado()) return [];
  const base = String(process.env.VIDEOPERITAJE_SDK_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const key = String(
    process.env.VIDEOPERITAJE_SDK_KEY || process.env.VIDEOPERITAJE_API_KEY || ''
  ).trim();
  // Importante: sin limit el API solo devuelve ~20 y deja fantasmas viejos fuera.
  const res = await fetch(`${base}/v1/sesiones?limit=500`, {
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `SDK HTTP ${res.status}`);
  const rows = Array.isArray(data.data) ? data.data : [];
  return rows.filter(isLiveSdkRow);
}

async function listarPgAbiertas() {
  if (!videoperitajePgConfigurado()) return [];
  const { rows } = await videoperitajePgQuery(
    `SELECT id, mongo_sesion_id, estado, nombre_asegurado AS asegurado_nombre,
            finalizada_at
     FROM videoperitaje.sesiones
     WHERE estado IN ('pendiente', 'en_proceso')
        OR finalizada_at IS NULL
     ORDER BY id DESC
     LIMIT 500`
  );
  return rows;
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
});

console.log({
  dry: DRY,
  sdk: videoperitajeSdkConfigurado(),
  pg: videoperitajePgConfigurado(),
});

const abiertasMongo = await VideoperitajeSesion.find({
  estado: { $in: ['pendiente', 'en_proceso'] },
})
  .select('_id aseguradoNombre estado')
  .lean();
const activaIds = new Set(abiertasMongo.map((s) => String(s._id)));
console.log(
  'Mongo activas (NO se tocan):',
  abiertasMongo.map((s) => `${s.estado}:${s.aseguradoNombre}`)
);

if (videoperitajeSdkConfigurado()) {
  try {
    console.log('Cupo antes:', (await sdkVerificarCupo('independiente'))?.cupo);
  } catch (e) {
    console.error('Cupo:', e.message);
  }
}

let sdkRows = [];
try {
  sdkRows = await listarSdkAbiertas();
} catch (e) {
  console.error('SDK list falló:', e.message);
}

let pgRows = [];
try {
  pgRows = await listarPgAbiertas();
} catch (e) {
  console.error('PG list falló:', e.message);
}

console.log('SDK live:', sdkRows.length, '| PG live:', pgRows.length);

const byMongo = new Map();
for (const row of [...sdkRows, ...pgRows]) {
  const mongoId = String(row.mongo_sesion_id || row.mongo_id || '').trim();
  if (!mongoId) continue;
  if (!byMongo.has(mongoId)) byMongo.set(mongoId, row);
}

let cerradas = 0;
let skippedActivas = 0;
let huerfanas = 0;

for (const [mongoId, row] of byMongo) {
  const label =
    row.nombre_asegurado || row.asegurado_nombre || row.expediente || mongoId;

  if (activaIds.has(mongoId)) {
    skippedActivas += 1;
    continue;
  }

  if (!OBJECT_ID_RE.test(mongoId)) {
    console.log('Huérfana (id no ObjectId):', {
      mongoId,
      sdkEstado: row.estado,
      label,
    });
    huerfanas += 1;
    if (!DRY) {
      await cerrarSesionPostgres(
        {
          _id: mongoId,
          estado: 'cancelada',
          fin: new Date(),
          duracionSeg: 0,
          notas: '[auto] Cierre fantasma SDK sin Mongo ObjectId',
          peritoLogin: 'sistema-sync-fantasmas',
        },
        { evento: 'force_end', actorLogin: 'sistema-sync-fantasmas' }
      );
    }
    cerradas += 1;
    continue;
  }

  const sesion = await VideoperitajeSesion.findById(mongoId).lean();
  if (!sesion) {
    console.log('Huérfana (sin Mongo):', {
      mongoId,
      sdkEstado: row.estado,
      label,
    });
    huerfanas += 1;
    if (!DRY) {
      await cerrarSesionPostgres(
        {
          _id: mongoId,
          estado: 'cancelada',
          fin: new Date(),
          duracionSeg: 0,
          notas: '[auto] Cierre fantasma SDK sin documento Mongo',
          peritoLogin: 'sistema-sync-fantasmas',
        },
        { evento: 'force_end', actorLogin: 'sistema-sync-fantasmas' }
      );
    }
    cerradas += 1;
    continue;
  }

  if (sesion.estado === 'pendiente' || sesion.estado === 'en_proceso') {
    skippedActivas += 1;
    continue;
  }

  console.log('Sync SDK/PG ← Mongo cerrada', {
    mongoId: String(sesion._id),
    mongoEstado: sesion.estado,
    sdkEstado: row.estado,
    asegurado: sesion.aseguradoNombre,
  });
  if (!DRY) {
    await cerrarSesionPostgres(sesion, {
      evento: 'force_end',
      actorLogin: 'sistema-sync-fantasmas',
    });
  }
  cerradas += 1;
}

console.log({
  dry: DRY,
  cerradas,
  skippedActivasMongo: skippedActivas,
  huerfanas,
});

if (!DRY && videoperitajeSdkConfigurado()) {
  try {
    console.log('Cupo después:', (await sdkVerificarCupo('independiente'))?.cupo);
  } catch (e) {
    console.error('Cupo post:', e.message);
  }
}

await mongoose.disconnect();
