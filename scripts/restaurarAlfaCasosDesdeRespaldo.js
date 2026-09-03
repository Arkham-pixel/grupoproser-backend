/**
 * Devuelve casos Alfa del respaldo a la colección operativa (mismo _id).
 * El ejemplar en GrupoProserAlfaRespaldo se conserva.
 *
 *   node scripts/restaurarAlfaCasosDesdeRespaldo.js --consecutivo ALFA-2026-08-3
 *   node scripts/restaurarAlfaCasosDesdeRespaldo.js --identificacion 12345678
 *   node scripts/restaurarAlfaCasosDesdeRespaldo.js --all --apply
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import {
  getAlfaRespaldoCollection,
  getAlfaRespaldoMovimientosCollection,
  restoreAlfaCasoFromRespaldoById,
} from '../services/alfaCasosRespaldoService.js';

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const consIdx = process.argv.indexOf('--consecutivo');
const idIdx = process.argv.indexOf('--identificacion');
const consecutivo = consIdx >= 0 ? String(process.argv[consIdx + 1] || '').trim() : '';
const identificacion = idIdx >= 0 ? String(process.argv[idIdx + 1] || '').trim() : '';

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 25000,
});

const col = getAlfaRespaldoCollection();
const filter = ALL
  ? {}
  : consecutivo
    ? { consecutivo }
    : identificacion
      ? { identificacion }
      : null;

if (!filter) {
  console.error(
    JSON.stringify({
      ok: false,
      error: 'Indique --consecutivo, --identificacion o --all',
    })
  );
  await mongoose.disconnect();
  process.exit(1);
}

const docs = await col.find(filter).project({ consecutivo: 1, identificacion: 1, asegurado: 1, estado: 1 }).toArray();
console.log(
  JSON.stringify(
    {
      event: 'PREVIEW',
      apply: APPLY,
      n: docs.length,
      sample: docs.slice(0, 15),
    },
    null,
    2
  )
);

if (!APPLY) {
  console.log(JSON.stringify({ event: 'DRY_RUN', hint: 'Agregue --apply para restaurar' }));
  await mongoose.disconnect();
  process.exit(0);
}

const restored = [];
for (const d of docs) {
  const out = await restoreAlfaCasoFromRespaldoById(d._id, { unexclude: true });
  restored.push({
    _id: String(d._id),
    consecutivo: out?.consecutivo || d.consecutivo,
    excluido: out?.excluidoBaseAlfa === true,
  });
}

await getAlfaRespaldoMovimientosCollection().insertOne({
  tipo: 'RESTORE_TO_OPERATIVA',
  at: new Date(),
  count: restored.length,
  ids: docs.map((d) => d._id),
  consecutivos: docs.map((d) => d.consecutivo),
});

console.log(JSON.stringify({ event: 'DONE', restored: restored.length, items: restored }, null, 2));
await mongoose.disconnect();
