/**
 * Equipo BBVA CAT: ajustadores/inspectores del listado oficial
 * y Miguel Andrés Báez como ajustador líder.
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

/** Listado oficial de campo (sin el líder Miguel). */
const CEDULAS = [
  '79754443', // Jairo Sadoc Puentes Morales
  '19304748', // Jorge Enrique Salazar Gonzalez
  '1032488802', // Douglas Santiago Puentes Cantor
  '52478912', // Ayfa Briced Herrera Merchan
  '79655067', // Javier Orlando Ramirez Rodriguez
  '14231484', // Oscar Villanueva Arias
  '1001826133', // Sebastian Alejandro Castro Gil
  '91180692', // Omar Rodolfo Pico Quintero
  '1083433781', // Yury Carolina Morantes
  '1095800166', // Juan Camilo Pardo Mesa
  '1041900044', // Karla Andrea Parada Rocha
  '1140829990', // Marisol Gómez Carreño
  '1002500141', // Adriel Jose Escorcia Pulgar
];

const CEDULAS_INSPECTORES = [...CEDULAS];

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  const db = mongoose.connection.db;
  const patch = {
    $set: {
      updatedAt: new Date(),
    },
    $addToSet: { modulos: 'bbvaCat' },
  };

  const codigosAju = CEDULAS.map((c) => `AJU-${c}`);
  const codigosIns = CEDULAS_INSPECTORES.map((c) => `INS-${c}`);
  const ins = await db.collection('gsk3cAppinspectorcatastrofico').updateMany(
    { codigo: { $in: codigosIns } },
    patch
  );
  const insDel = await db.collection('gsk3cAppinspectorcatastrofico').updateMany(
    { codigo: { $nin: codigosIns }, modulos: 'bbvaCat' },
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
      { nmbrRespnsble: /miguel\s+andres\s+b[aá]ez/i },
      { nmbrRespnsble: /miguel\s+b[aá]ez/i },
      { codiRespnsble: 'MIGUEL-BAEZ' },
    ],
  });

  let lider = existente;
  if (!existente) {
    const doc = {
      codiRespnsble: 'MIGUEL-BAEZ',
      nmbrRespnsble: 'Miguel Andrés Báez Zuluaga',
      email: 'miguelandresbaez@gmail.com',
      telefono: '3006347645',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const insResp = await colResp.insertOne(doc);
    lider = { _id: insResp.insertedId, ...doc };
    console.log('✅ Ajustador líder creado: Miguel Andrés Báez Zuluaga');
  } else {
    await colResp.updateOne(
      { _id: existente._id },
      {
        $set: {
          nmbrRespnsble: 'Miguel Andrés Báez Zuluaga',
          email: 'miguelandresbaez@gmail.com',
          telefono: '3006347645',
          updatedAt: new Date(),
        },
      }
    );
    console.log('🔄 Ajustador líder actualizado: Miguel Andrés Báez Zuluaga');
  }

  const ajustadoresBbva = await db
    .collection('gsk3cAppajustadorcatastrofico')
    .find({ codigo: { $in: codigosAju } })
    .project({ codigo: 1, nombre: 1, ciudad: 1, modulos: 1 })
    .toArray();
  const inspectoresBbva = await db
    .collection('gsk3cAppinspectorcatastrofico')
    .find({ codigo: { $in: codigosIns } })
    .project({ codigo: 1, nombre: 1, ciudad: 1, modulos: 1 })
    .toArray();

  console.log(
    JSON.stringify(
      {
        inspectoresActualizados: ins.modifiedCount,
        inspectoresBbvaQuitados: insDel.modifiedCount,
        inspectoresBbva: inspectoresBbva.map((a) => ({
          codigo: a.codigo,
          nombre: a.nombre,
          ciudad: a.ciudad,
          modulos: a.modulos,
        })),
        ajustadoresActualizados: aju.modifiedCount,
        ajustadoresBbvaQuitados: ajuExtra.modifiedCount,
        ajustadoresBbva: ajustadoresBbva.map((a) => ({
          codigo: a.codigo,
          nombre: a.nombre,
          ciudad: a.ciudad,
          modulos: a.modulos,
        })),
        lider: {
          id: String(lider._id),
          nombre: lider.nmbrRespnsble || 'Miguel Andrés Báez Zuluaga',
        },
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Error:', err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
