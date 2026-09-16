/**
 * Replica el equipo BBVA CAT de ajustadores hacia inspectores
 * (mismo personal, códigos INS-*, módulo bbvaCat).
 *
 * Uso: node scripts/sincronizar_inspectores_bbva_cat.js
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

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  const db = mongoose.connection.db;
  const colAj = db.collection('gsk3cAppajustadorcatastrofico');
  const colIns = db.collection('gsk3cAppinspectorcatastrofico');

  const ajustadores = await colAj.find({ modulos: 'bbvaCat' }).toArray();
  const resultados = [];

  for (const aj of ajustadores) {
    const cedula = String(aj.codigo || '').replace(/^AJU-/i, '').trim();
    if (!cedula) continue;
    const codigoIns = `INS-${cedula}`;
    const doc = {
      codigo: codigoIns,
      nombre: aj.nombre || '',
      email: aj.email || '',
      telefono: aj.telefono || '',
      ciudad: aj.ciudad || 'Todas',
      updatedAt: new Date(),
    };

    const match = await colIns.findOne({
      $or: [{ codigo: codigoIns }, { nombre: aj.nombre }],
    });

    if (match) {
      await colIns.updateOne(
        { _id: match._id },
        {
          $set: {
            ...doc,
            codigo: match.codigo || codigoIns,
          },
          $addToSet: { modulos: 'bbvaCat' },
        }
      );
      resultados.push({ estado: 'ACTUALIZADO', codigo: match.codigo || codigoIns, nombre: doc.nombre });
    } else {
      await colIns.insertOne({
        ...doc,
        modulos: ['bbvaCat'],
        createdAt: new Date(),
      });
      resultados.push({ estado: 'CREADO', codigo: codigoIns, nombre: doc.nombre });
    }
  }

  // Quitar bbvaCat de inspectores que ya no están en el equipo de ajustadores
  const codigosOk = resultados.map((r) => r.codigo);
  const quitados = await colIns.updateMany(
    { codigo: { $nin: codigosOk }, modulos: 'bbvaCat' },
    { $pull: { modulos: 'bbvaCat' }, $set: { updatedAt: new Date() } }
  );

  const finales = await colIns
    .find({ modulos: 'bbvaCat' })
    .project({ codigo: 1, nombre: 1 })
    .sort({ nombre: 1 })
    .toArray();

  console.log(
    JSON.stringify(
      {
        procesados: resultados.length,
        quitados: quitados.modifiedCount,
        inspectoresBbva: finales,
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
