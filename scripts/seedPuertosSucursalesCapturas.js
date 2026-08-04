/**
 * Carga en Mongo las aseguradoras/sucursales de capturas (seed upsert).
 * Uso: node scripts/seedPuertosSucursalesCapturas.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { seedDefaults } from '../services/puertosCatalogoService.js';
import {
  ASEGURADORAS_PUERTOS_DEFAULT,
  SUCURSALES_PUERTOS_DEFAULT,
} from '../constants/puertosCatalogoDefaults.js';

dotenv.config();

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI;

async function main() {
  if (!uri) {
    console.error('Falta MONGODB_URI / MONGO_URI en backend/.env');
    process.exit(1);
  }

  console.log('Conectando…');
  await mongoose.connect(uri);
  console.log(
    `Seed catálogos Puertos (aseguradoras=${ASEGURADORAS_PUERTOS_DEFAULT.length}, sucursales=${SUCURSALES_PUERTOS_DEFAULT.length})…`
  );
  const result = await seedDefaults();
  console.log('Resultado:', result);
  console.log('RESULT: OK');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
