/**
 * Diagnóstico: sesiones Mongo vs Postgres vs LiveKit (sin cerrar activas recientes).
 *   node scripts/diagVideoperitajeSesionesActivas.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import VideoperitajeSesion from '../models/VideoperitajeSesion.js';

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
});

const abiertasMongo = await VideoperitajeSesion.find({
  estado: { $in: ['pendiente', 'en_proceso'] },
})
  .select(
    'estado tipo modulo expediente aseguradoNombre peritoLogin peritoNombre inicio createdAt livekitRoom'
  )
  .sort({ createdAt: -1 })
  .lean();

console.log('\n=== MONGO abiertas ===', abiertasMongo.length);
for (const s of abiertasMongo) {
  const hrs = ((Date.now() - new Date(s.inicio || s.createdAt).getTime()) / 3600000).toFixed(1);
  console.log({
    id: String(s._id),
    estado: s.estado,
    asegurado: s.aseguradoNombre,
    perito: s.peritoNombre || s.peritoLogin,
    hrs,
    createdAtCOT: new Date(s.createdAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
    expediente: s.expediente,
    room: s.livekitRoom,
  });
}

// canceladas hoy con nota auto
const canceladasHoy = await VideoperitajeSesion.find({
  estado: 'cancelada',
  fin: { $gte: new Date(Date.now() - 24 * 3600 * 1000) },
  notas: /auto.*colgada|Cerrada: sesión colgada/i,
})
  .select('_id aseguradoNombre estado fin notas livekitRoom')
  .lean();
console.log('\n=== Canceladas auto (24h) ===', canceladasHoy.length);
for (const s of canceladasHoy) {
  console.log({
    id: String(s._id),
    asegurado: s.aseguradoNombre,
    fin: s.fin,
    room: s.livekitRoom,
  });
}

// Postgres mirror
let pg = null;
try {
  const { getVideoperitajePgPool, isVideoperitajePgConfigured } = await import(
    '../config/videoperitajePostgres.js'
  );
  if (isVideoperitajePgConfigured?.() || true) {
    const { default: cfg } = await import('../config/videoperitajePostgres.js').catch(() => ({
      default: null,
    }));
    void cfg;
  }
  const mod = await import('../services/videoperitajePgService.js');
  if (typeof mod.listarSesionesAbiertasPostgres === 'function') {
    pg = await mod.listarSesionesAbiertasPostgres();
  } else if (typeof mod.querySesionesAbiertas === 'function') {
    pg = await mod.querySesionesAbiertas();
  } else {
    // raw
    const poolMod = await import('../config/videoperitajePostgres.js');
    const pool =
      poolMod.getVideoperitajePgPool?.() ||
      poolMod.default?.getVideoperitajePgPool?.() ||
      null;
    if (pool) {
      const r = await pool.query(
        `SELECT id, mongo_id, estado, asegurado_nombre, perito_login, started_at, ended_at, room_name
         FROM videoperitaje_sesiones
         WHERE estado IN ('pendiente','en_proceso') OR ended_at IS NULL
         ORDER BY started_at DESC NULLS LAST
         LIMIT 50`
      );
      pg = r.rows;
    }
  }
} catch (e) {
  console.log('\n=== Postgres === error:', e.message);
}

if (pg) {
  console.log('\n=== Postgres abiertas / sin fin ===', Array.isArray(pg) ? pg.length : pg);
  console.log(JSON.stringify(pg, null, 2).slice(0, 4000));
}

await mongoose.disconnect();
