/**
 * Copia gsk3cAppresponsable → gsk3cAppajustadorcatastrofico
 * (una fila por responsable; ciudad pendiente de asignar = aparece en todos los filtros).
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const CIUDAD_TODAS = 'Todas';

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const responsables = await db.collection('gsk3cAppresponsable').find({}).toArray();
  const col = db.collection('gsk3cAppajustadorcatastrofico');

  let creados = 0;
  let omitidos = 0;

  for (const r of responsables) {
    const codigo = String(r.codiRespnsble ?? '').trim();
    const nombre = String(r.nmbrRespnsble ?? '').trim();
    if (!codigo || !nombre) {
      omitidos += 1;
      continue;
    }
    const existe = await col.findOne({ codigo });
    if (existe) {
      omitidos += 1;
      continue;
    }
    await col.insertOne({
      codigo,
      nombre,
      email: String(r.email ?? '').trim(),
      telefono: String(r.telefono ?? '').trim(),
      ciudad: CIUDAD_TODAS,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    creados += 1;
  }

  const total = await col.countDocuments();
  console.log(JSON.stringify({ responsables: responsables.length, creados, omitidos, total }, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
