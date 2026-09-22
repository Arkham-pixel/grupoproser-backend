/**
 * Borra todas las sesiones de Videoperitaje (historial de pruebas).
 * Uso: node scripts/vaciarHistorialVideoperitaje.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import VideoperitajeSesion from '../models/VideoperitajeSesion.js';

const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
if (!uri) {
  console.error('Falta MONGO_URI');
  process.exit(1);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
const antes = await VideoperitajeSesion.countDocuments();
const r = await VideoperitajeSesion.deleteMany({});
console.log(`Videoperitaje: borradas ${r.deletedCount} de ${antes} sesiones`);
await mongoose.disconnect();
process.exit(0);
