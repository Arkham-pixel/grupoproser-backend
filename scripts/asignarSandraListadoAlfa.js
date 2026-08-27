/**
 * Asigna a Sandra los consecutivos del listado (excepto ALFA-2026-08-1288).
 * Uso: node scripts/asignarSandraListadoAlfa.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const EXCLUIR = new Set(['ALFA-2026-08-1288']);
const LISTADO = [
  'ALFA-2026-08-1518',
  'ALFA-2026-08-1384',
  'ALFA-2026-08-1300',
  'ALFA-2026-08-860',
  'ALFA-2026-08-804',
  'ALFA-2026-08-513',
  'ALFA-2026-08-841',
  'ALFA-2026-08-1288', // excluido (rojo)
  'ALFA-2026-08-1570',
  'ALFA-2026-08-497',
  'ALFA-2026-08-977',
  'ALFA-2026-08-816',
  'ALFA-2026-08-648',
  'ALFA-2026-08-762',
];

const consecutivos = LISTADO.filter((c) => !EXCLUIR.has(c));

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 20000,
});
const db = mongoose.connection.db;
const colAj = db.collection('gsk3cAppajustadorcatastrofico');
const col = db.collection('gsk3cAppsegurosAlfaCasos');

const sandra = await colAj.findOne({ nombre: /sandra\s+patricia/i });
const nombre = String(sandra?.nombre || 'SANDRA PATRICIA SÁNCHEZ CAÑAS').trim();

const antes = await col
  .find({ consecutivo: { $in: consecutivos } })
  .project({ consecutivo: 1, asegurado: 1, ajustador: 1, inspector: 1 })
  .toArray();
const hallados = new Set(antes.map((c) => c.consecutivo));
const faltantes = consecutivos.filter((c) => !hallados.has(c));

const res = await col.updateMany(
  { consecutivo: { $in: consecutivos } },
  { $set: { ajustador: nombre, inspector: nombre, updatedAt: new Date() } }
);

const despues = await col
  .find({ consecutivo: { $in: consecutivos } })
  .project({ consecutivo: 1, asegurado: 1, ajustador: 1, inspector: 1 })
  .toArray();
despues.sort((a, b) =>
  String(a.consecutivo).localeCompare(String(b.consecutivo), 'es', { numeric: true })
);

console.log(
  JSON.stringify(
    {
      asignadoA: nombre,
      pedidos: consecutivos.length,
      excluidos: [...EXCLUIR],
      encontrados: antes.length,
      faltantes,
      matched: res.matchedCount,
      modified: res.modifiedCount,
      asignados: despues,
    },
    null,
    2
  )
);

await mongoose.disconnect();
