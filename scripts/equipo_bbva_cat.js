/**
 * Equipo BBVA CAT: ajustadores fijos (sin inspectores)
 * y Miguel Báez como ajustador líder.
 *
 * Uso: node scripts/equipo_bbva_cat.js
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

const CEDULAS = [
  '1001826133',
  '1144098774',
  '91180692',
  '79754443',
  '19304748',
  '51698891',
  '1007414691',
  '1032488802',
  '19419745',
  '52478912',
  '79655067',
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  const db = mongoose.connection.db;
  const patch = {
    $set: {
      ciudad: 'Todas',
      updatedAt: new Date(),
    },
    $addToSet: { modulos: 'bbvaCat' },
  };

  const codigosAju = CEDULAS.map((c) => `AJU-${c}`);
  const insDel = await db.collection('gsk3cAppinspectorcatastrofico').updateMany(
    { modulos: 'bbvaCat' },
    { $pull: { modulos: 'bbvaCat' }, $set: { updatedAt: new Date() } }
  );
  const aju = await db.collection('gsk3cAppajustadorcatastrofico').updateMany(
    { codigo: { $in: codigosAju } },
    patch
  );
  const ajuExtra = await db.collection('gsk3cAppajustadorcatastrofico').updateMany(
    { codigo: { $nin: codigosAju }, modulos: 'bbvaCat' },
    { $pull: { modulos: 'bbvaCat' }, $set: { updatedAt: new Date() } }
  );

  const colResp = db.collection('gsk3cAppresponsable');
  const existente = await colResp.findOne({
    $or: [
      { nmbrRespnsble: /miguel\s+b[aá]ez/i },
      { codiRespnsble: 'MIGUEL-BAEZ' },
    ],
  });

  let lider = existente;
  if (!existente) {
    const doc = {
      codiRespnsble: 'MIGUEL-BAEZ',
      nmbrRespnsble: 'Miguel Báez',
      email: '',
      telefono: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const insResp = await colResp.insertOne(doc);
    lider = { _id: insResp.insertedId, ...doc };
    console.log('✅ Ajustador líder creado: Miguel Báez');
  } else {
    await colResp.updateOne(
      { _id: existente._id },
      { $set: { nmbrRespnsble: 'Miguel Báez', updatedAt: new Date() } }
    );
    console.log('🔄 Ajustador líder ya existía: Miguel Báez');
  }

  const ajustadoresBbva = await db
    .collection('gsk3cAppajustadorcatastrofico')
    .find({ codigo: { $in: codigosAju } })
    .project({ codigo: 1, nombre: 1, ciudad: 1, modulos: 1 })
    .toArray();

  console.log(
    JSON.stringify(
      {
        inspectoresBbvaQuitados: insDel.modifiedCount,
        ajustadoresActualizados: aju.modifiedCount,
        ajustadoresMatched: aju.matchedCount,
        otrosAjustadoresSinBbva: ajuExtra.modifiedCount,
        ajustadoresBbva: ajustadoresBbva.map((a) => ({
          codigo: a.codigo,
          nombre: a.nombre,
          ciudad: a.ciudad,
          modulos: a.modulos,
        })),
        lider: {
          codigo: lider.codiRespnsble,
          nombre: 'Miguel Báez',
        },
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
