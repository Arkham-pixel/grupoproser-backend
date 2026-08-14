/**
 * Limpia coords falsas de direcciones placeholder (PENDIENTE / POR CONFIRMAR / vacío).
 * Uso: node scripts/cleanupAlfaPlaceholderGeocodes.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  esDireccionPredioGeocodableAlfa,
  obtenerBloquesCercaniaAlfa,
} from '../services/alfaBloquesCercaniaService.js';

await mongoose.connect(process.env.MONGO_URI);
const casos = await SegurosAlfaCaso.find({})
  .select('consecutivo direccionPredio ubicacionPredio')
  .lean();

let cleaned = 0;
for (const c of casos) {
  if (esDireccionPredioGeocodableAlfa(c.direccionPredio)) continue;
  const u = c.ubicacionPredio || {};
  if (
    !Number.isFinite(Number(u.lat)) &&
    !Number.isFinite(Number(u.lng)) &&
    u.geocodeStatus === 'sin_direccion'
  ) {
    continue;
  }
  await SegurosAlfaCaso.findByIdAndUpdate(c._id, {
    $set: {
      'ubicacionPredio.geocodeStatus': 'sin_direccion',
      'ubicacionPredio.geocodedAt': new Date(),
    },
    $unset: {
      'ubicacionPredio.lat': '',
      'ubicacionPredio.lng': '',
    },
  });
  cleaned += 1;
  console.log('cleaned', c.consecutivo, c.direccionPredio || '(vacío)');
}

const res = await obtenerBloquesCercaniaAlfa({ radioKm: 2.5 });
console.log(
  JSON.stringify(
    {
      cleaned,
      total: res.totalCasos,
      ubicados: res.ubicados,
      sinUbicar: res.sinUbicarCount,
      sinUbicarCons: res.sinUbicar.map((x) => x.consecutivo),
    },
    null,
    2
  )
);
await mongoose.disconnect();
