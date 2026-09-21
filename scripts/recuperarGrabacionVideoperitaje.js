import '../config/loadEnv.js';
import '../config/mongoDns.js';
import mongoose from 'mongoose';
import VideoperitajeSesion from '../models/VideoperitajeSesion.js';
import { adjuntarMediasAlCaso } from '../services/videoperitajeCasoService.js';
import { headObject } from '../services/s3StorageService.js';

const sesionId = process.argv[2];
const key = String(process.argv[3] || '').replace(/^s3:/, '');
const size = Number(process.argv[4] || 0);

if (!sesionId || !key) {
  console.error('Uso: node scripts/recuperarGrabacionVideoperitaje.js <sesionId> <s3Key> [bytes]');
  process.exit(1);
}

const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
await mongoose.connect(uri);
const sesion = await VideoperitajeSesion.findById(sesionId);
if (!sesion) {
  console.error('Sesión no encontrada');
  process.exit(1);
}

const ruta = `s3:${key}`;
if ((sesion.medias || []).some((m) => String(m.ruta) === ruta)) {
  console.log('La grabación ya estaba en la sesión');
  await mongoose.disconnect();
  process.exit(0);
}

await headObject(key);
sesion.medias.push({
  nombreOriginal: 'grabacion-llamada.webm',
  nombreArchivo: key.split('/').pop(),
  ruta,
  tamaño: size || undefined,
  tipoMime: 'video/webm',
  tipo: 'video',
  descripcion: 'Grabación de la videollamada',
  subidoPorRol: 'perito',
});
await sesion.save();
if (sesion.casoId) {
  await adjuntarMediasAlCaso(sesion, sesion.medias);
}
console.log(`OK: ${sesion.medias.length} evidencias en la sesión`);
await mongoose.disconnect();
