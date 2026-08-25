import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { espejarArchivosCatExistentesEnListado } from '../utils/espejarArchivoBbvaCatEnListado.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (!process.env.MONGO_URI) {
  console.error('Falta MONGO_URI');
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);
const resumen = await espejarArchivosCatExistentesEnListado();
console.log(JSON.stringify(resumen, null, 2));
await mongoose.disconnect();
process.exit(0);
