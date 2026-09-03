/**
 * Copia casos Alfa con excluidoBaseAlfa=true a la base GrupoProserAlfaRespaldo
 * y los quita de la colección operativa, para que Power BI coincida con ARNALD.
 *
 *   node scripts/moverAlfaExcluidosARespaldo.js
 *   node scripts/moverAlfaExcluidosARespaldo.js --apply
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  ALFA_RESPALDO_COLLECTION,
  ALFA_RESPALDO_DB_NAME,
} from '../config/alfaRespaldoDb.js';
import {
  ensureAlfaRespaldoIndexes,
  getAlfaRespaldoCollection,
  getAlfaRespaldoMovimientosCollection,
} from '../services/alfaCasosRespaldoService.js';

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const APPLY = process.argv.includes('--apply');
const FILTER = { excluidoBaseAlfa: true };

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 25000,
});

const src = SegurosAlfaCaso.collection;
const docs = await src.find(FILTER).toArray();
const activeBefore = await src.countDocuments({
  $or: [{ excluidoBaseAlfa: { $exists: false } }, { excluidoBaseAlfa: false }],
});
const totalBefore = await src.countDocuments();

const dest = getAlfaRespaldoCollection();
const already = docs.length
  ? await dest.countDocuments({ _id: { $in: docs.map((d) => d._id) } })
  : 0;

console.log(
  JSON.stringify(
    {
      event: 'PREVIEW',
      apply: APPLY,
      sourceDb: mongoose.connection.db.databaseName,
      destDb: ALFA_RESPALDO_DB_NAME,
      destCollection: ALFA_RESPALDO_COLLECTION,
      totalOperativa: totalBefore,
      activosOperativa: activeBefore,
      aMover: docs.length,
      yaEnRespaldo: already,
      estados: docs.reduce((acc, d) => {
        const k = d.estado || '(sin estado)';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
    },
    null,
    2
  )
);

if (!APPLY) {
  console.log(
    JSON.stringify({
      event: 'DRY_RUN',
      hint: 'Vuelva a correr con --apply para copiar y sacar de la operativa',
    })
  );
  await mongoose.disconnect();
  process.exit(0);
}

if (!docs.length) {
  console.log(JSON.stringify({ event: 'NOTHING_TO_MOVE' }));
  await mongoose.disconnect();
  process.exit(0);
}

await ensureAlfaRespaldoIndexes();
const movedAt = new Date();
const stamped = docs.map((d) => ({
  ...d,
  respaldoAlfa: {
    movedAt,
    sourceDb: mongoose.connection.db.databaseName,
    sourceCollection: src.collectionName,
    reason: d.excluidoBaseAlfaReason || 'excluidoBaseAlfa',
  },
}));

const ops = stamped.map((d) => ({
  replaceOne: {
    filter: { _id: d._id },
    replacement: d,
    upsert: true,
  },
}));
const bulk = await dest.bulkWrite(ops, { ordered: false });
const copied = await dest.countDocuments({ _id: { $in: docs.map((d) => d._id) } });
if (copied !== docs.length) {
  console.error(
    JSON.stringify({
      event: 'COPY_MISMATCH',
      expected: docs.length,
      copied,
      bulk,
    })
  );
  await mongoose.disconnect();
  process.exit(1);
}

const del = await src.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
const activeAfter = await src.countDocuments({
  $or: [{ excluidoBaseAlfa: { $exists: false } }, { excluidoBaseAlfa: false }],
});
const archivedLeft = await src.countDocuments(FILTER);
const totalAfter = await src.countDocuments();

await getAlfaRespaldoMovimientosCollection().insertOne({
  tipo: 'MOVE_EXCLUIDOS',
  at: movedAt,
  count: docs.length,
  deletedFromOperativa: del.deletedCount,
  ids: docs.map((d) => d._id),
  consecutivos: docs.map((d) => d.consecutivo),
  sourceDb: mongoose.connection.db.databaseName,
  destDb: ALFA_RESPALDO_DB_NAME,
});

console.log(
  JSON.stringify(
    {
      event: 'DONE',
      copied,
      deletedFromOperativa: del.deletedCount,
      totalOperativaAfter: totalAfter,
      activosOperativaAfter: activeAfter,
      archivadosQueQuedan: archivedLeft,
      respaldoCount: await dest.countDocuments(),
    },
    null,
    2
  )
);

await mongoose.disconnect();
