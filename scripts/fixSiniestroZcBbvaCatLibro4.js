/**
 * Corrige siniestro basura (0, códigos cortos) → NSINIESTRO/zc.
 * No toca estado ni demás campos.
 *
 *   node scripts/fixSiniestroZcBbvaCatLibro4.js --apply
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import mongoose from 'mongoose';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';

const APPLY = process.argv.includes('--apply');
const ZCS = [
  '100017876',
  '100017942',
  '100017948',
  '100017952',
  '100017958',
  '100017965',
  '100018093',
  '100017757',
];

function siniestroRoto(valor) {
  const s = String(valor ?? '').trim();
  if (!s || s === '0') return true;
  if (!/^\d+$/.test(s)) return true;
  if (s.length < 6) return true;
  return false;
}

async function fix(Model, nombre) {
  const docs = await Model.find({ zc: { $in: ZCS } }).select('_id zc siniestro estado asegurado');
  const cambios = [];
  for (const d of docs) {
    if (!siniestroRoto(d.siniestro)) continue;
    const antes = d.siniestro;
    cambios.push({
      coleccion: nombre,
      zc: d.zc,
      asegurado: d.asegurado,
      estado: d.estado,
      siniestroAntes: antes,
      siniestroDespues: d.zc,
    });
    if (APPLY) {
      d.siniestro = d.zc;
      await d.save();
    }
  }
  return cambios;
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);
const [cat, list] = await Promise.all([
  fix(BbvaCatCaso, 'CAT'),
  fix(BbvaCatListadoCaso, 'LISTADO'),
]);
console.log(
  JSON.stringify(
    {
      modo: APPLY ? 'APPLY' : 'DRY-RUN',
      corregidosCat: cat.length,
      corregidosListado: list.length,
      detalle: [...cat, ...list],
    },
    null,
    2
  )
);
await mongoose.disconnect();
