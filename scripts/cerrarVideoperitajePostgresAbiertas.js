/**
 * Por qué siguen “corriendo”: el cierre anterior solo tocó Mongo;
 * el monitor lee Postgres (videoperitaje.sesiones).
 * Este script cierra en PG lo que ya está cancelado/finalizado en Mongo
 * y cualquier sesión PG abierta > 6h.
 *
 *   node scripts/cerrarVideoperitajePostgresAbiertas.js
 */
import '../config/loadEnv.js';

// loadEnv pisa .env en local (ENABLED=0); --force-pg permite limpiar el monitor igual.
if (process.argv.includes('--force-pg')) {
  process.env.VIDEOPERITAJE_PG_ENABLED = '1';
  if (!process.env.VIDEOPERITAJE_PG_SSL) process.env.VIDEOPERITAJE_PG_SSL = '1';
}

import mongoose from 'mongoose';
import VideoperitajeSesion from '../models/VideoperitajeSesion.js';
import {
  videoperitajePgConfigurado,
  videoperitajePgQuery,
} from '../config/videoperitajePostgres.js';
import { cerrarSesionPostgres } from '../services/videoperitajePgService.js';
import { cerrarSalaLivekit, nombreSalaLivekit } from '../services/videoperitajeLivekitService.js';

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
});

console.log('PG configurado:', videoperitajePgConfigurado(), {
  enabled: process.env.VIDEOPERITAJE_PG_ENABLED,
  host: process.env.VIDEOPERITAJE_PG_HOST,
  db: process.env.VIDEOPERITAJE_PG_DATABASE,
});

const mongoAbiertas = await VideoperitajeSesion.find({
  estado: { $in: ['pendiente', 'en_proceso'] },
})
  .select('estado aseguradoNombre peritoLogin inicio createdAt expediente')
  .lean();
console.log('\nMongo abiertas:', mongoAbiertas.length);
for (const s of mongoAbiertas) {
  console.log({
    id: String(s._id),
    estado: s.estado,
    asegurado: s.aseguradoNombre,
    hrs: ((Date.now() - new Date(s.inicio || s.createdAt).getTime()) / 3600000).toFixed(1),
  });
}

if (!videoperitajePgConfigurado()) {
  console.log('\nPostgres NO habilitado — el monitor no debería leer PG.');
  await mongoose.disconnect();
  process.exit(0);
}

const { rows: pgAbiertas } = await videoperitajePgQuery(
  `SELECT s.id, s.mongo_sesion_id, s.estado, s.asegurado_nombre, s.expediente,
          s.iniciada_at, s.created_at, s.finalizada_at,
          a.nombre AS auditor_nombre, a.login AS auditor_login,
          c.nombre AS compania_nombre
     FROM videoperitaje.sesiones s
     LEFT JOIN videoperitaje.auditores a ON a.id = s.auditor_id
     LEFT JOIN videoperitaje.companias c ON c.id = s.compania_id
    WHERE s.estado IN ('pendiente', 'en_proceso')
    ORDER BY COALESCE(s.iniciada_at, s.created_at) ASC`
);

console.log('\nPostgres abiertas:', pgAbiertas.length);
for (const r of pgAbiertas) {
  const t0 = r.iniciada_at || r.created_at;
  const hrs = t0 ? ((Date.now() - new Date(t0).getTime()) / 3600000).toFixed(1) : '?';
  console.log({
    pgId: r.id,
    mongo: r.mongo_sesion_id,
    estado: r.estado,
    asegurado: r.asegurado_nombre,
    auditor: r.auditor_nombre || r.auditor_login,
    compania: r.compania_nombre,
    hrs,
    expediente: r.expediente,
  });
}

let cerradasPg = 0;
let cerradasMongo = 0;

for (const r of pgAbiertas) {
  const mongoId = r.mongo_sesion_id;
  let mongo = null;
  if (mongoId) {
    mongo = await VideoperitajeSesion.findById(mongoId).lean();
  }

  const t0 = new Date(r.iniciada_at || r.created_at || Date.now());
  const hrs = (Date.now() - t0.getTime()) / 3600000;
  const mongoCerrada =
    mongo && ['finalizada', 'cancelada'].includes(String(mongo.estado || ''));
  const colgada = hrs >= 6;

  if (!mongoCerrada && !colgada) {
    console.log('SKIP activa reciente', r.id, r.asegurado_nombre, `hrs=${hrs.toFixed(1)}`);
    continue;
  }

  // Si Mongo sigue abierta y está colgada, cancelar Mongo también
  if (mongo && ['pendiente', 'en_proceso'].includes(mongo.estado) && colgada) {
    try {
      await cerrarSalaLivekit(mongo.livekitRoom || nombreSalaLivekit(mongo._id));
    } catch {
      /* room may not exist */
    }
    const fin = new Date();
    const duracionSeg = Math.max(
      0,
      Math.round((fin.getTime() - new Date(mongo.inicio || mongo.createdAt).getTime()) / 1000)
    );
    await VideoperitajeSesion.updateOne(
      { _id: mongo._id },
      {
        $set: {
          estado: 'cancelada',
          fin,
          duracionSeg,
          notas: [mongo.notas, '[auto] Cerrada: colgada en monitor PG']
            .filter(Boolean)
            .join('\n'),
        },
      }
    );
    mongo = await VideoperitajeSesion.findById(mongo._id).lean();
    cerradasMongo += 1;
  }

  const sesionParaPg = mongo || {
    _id: mongoId || r.id,
    estado: 'cancelada',
    fin: new Date(),
    duracionSeg: Math.max(0, Math.round(hrs * 3600)),
    notas: '[auto] Cierre PG sesión huérfana/colgada',
    peritoLogin: r.auditor_login || '',
  };
  if (!mongo) {
    // forzar update directo si no hay mongo
    await videoperitajePgQuery(
      `UPDATE videoperitaje.sesiones SET
         estado = 'cancelada',
         finalizada_at = NOW(),
         duracion_segundos = COALESCE($2, duracion_segundos),
         updated_at = NOW()
       WHERE id = $1`,
      [r.id, Math.round(hrs * 3600)]
    );
  } else {
    await cerrarSesionPostgres(sesionParaPg, {
      evento: 'force_end',
      actorLogin: 'sistema-auto',
    });
  }
  cerradasPg += 1;
  console.log('CERRADA PG', r.id, r.asegurado_nombre, {
    motivo: mongoCerrada ? 'mongo_ya_cerrada' : 'colgada_>6h',
  });
}

const { rows: quedan } = await videoperitajePgQuery(
  `SELECT count(*)::int AS n FROM videoperitaje.sesiones
    WHERE estado IN ('pendiente', 'en_proceso')`
);
const mongoQuedan = await VideoperitajeSesion.countDocuments({
  estado: { $in: ['pendiente', 'en_proceso'] },
});

console.log('\n=== RESULTADO ===');
console.log({
  cerradasPg,
  cerradasMongo,
  pgQuedanAbiertas: quedan[0]?.n,
  mongoQuedanAbiertas: mongoQuedan,
});

await mongoose.disconnect();
process.exit(0);
