/**
 * Diagnóstico: casos Alfa sin ajustador y posibles fuentes de restauración.
 * Uso: node scripts/diagAjustadoresAlfaBorrados.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;
const col = db.collection('gsk3cAppsegurosAlfaCasos');

const sinFiltro = {
  $or: [{ ajustador: null }, { ajustador: '' }, { ajustador: { $exists: false } }],
};
const conFiltro = { ajustador: { $nin: [null, ''] } };

const total = await col.countDocuments({});
const conAj = await col.countDocuments(conFiltro);
const sinAj = await col.countDocuments(sinFiltro);
const conLider = await col.countDocuments({ ajustadorLider: { $nin: [null, ''] } });
const desde = new Date('2026-08-16T00:00:00.000Z');
const sinAjRecientes = await col.countDocuments({
  updatedAt: { $gte: desde },
  ...sinFiltro,
});

const sampleSin = await col
  .find(sinFiltro)
  .project({
    consecutivo: 1,
    siniestro: 1,
    ciudad: 1,
    ajustador: 1,
    ajustadorLider: 1,
    inspector: 1,
    updatedAt: 1,
    asegurado: 1,
  })
  .sort({ updatedAt: -1 })
  .limit(20)
  .toArray();

const sampleCon = await col
  .find(conFiltro)
  .project({ consecutivo: 1, ciudad: 1, ajustador: 1, updatedAt: 1 })
  .limit(15)
  .toArray();

const porAjustador = await col
  .aggregate([
    { $match: conFiltro },
    { $group: { _id: '$ajustador', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ])
  .toArray();

const cols = await db.listCollections().toArray();
const nombres = cols.map((c) => c.name).filter((n) => /alfa|ajust|audit|hist|import|excel|outbox/i.test(n));

let importRowsConAj = 0;
let importSample = [];
if (nombres.includes('gsk3cAppalfaexcelimportrows') || nombres.some((n) => /importrow/i.test(n))) {
  const rowColName =
    nombres.find((n) => /importrow/i.test(n)) || 'gsk3cAppalfaexcelimportrows';
  try {
    const rowCol = db.collection(rowColName);
    importRowsConAj = await rowCol.countDocuments({
      $or: [
        { 'changes.ajustador': { $exists: true } },
        { 'previewSnapshot.ajustador': { $exists: true } },
        { 'after.ajustador': { $exists: true } },
        { 'before.ajustador': { $exists: true } },
      ],
    });
    importSample = await rowCol
      .find({})
      .project({ changes: 1, previewSnapshot: 1, before: 1, after: 1, consecutivo: 1 })
      .limit(3)
      .toArray();
  } catch (e) {
    importSample = [{ error: e.message }];
  }
}

const catalogo = await db
  .collection('gsk3cAppajustadorcatastrofico')
  .find({})
  .project({ codigo: 1, nombre: 1, ciudad: 1 })
  .limit(50)
  .toArray();

console.log(
  JSON.stringify(
    {
      total,
      conAj,
      sinAj,
      conLider,
      sinAjRecientes,
      porAjustador,
      sampleSin,
      sampleCon,
      colecciones: nombres,
      importRowsConAj,
      importSample,
      catalogo,
    },
    null,
    2
  )
);

await mongoose.disconnect();
