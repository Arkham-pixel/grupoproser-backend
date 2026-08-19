/**
 * Geocodifica casos Alfa pendientes (nuevos importados sin coords).
 * Uso: node scripts/geocodeAlfaPendientesNow.js [limit]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {
  geocodeCasosAlfaPendientes,
  esDireccionPredioGeocodableAlfa,
} from '../services/alfaBloquesCercaniaService.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';

const limit = Number(process.argv[2] || 120);

await mongoose.connect(process.env.MONGO_URI);

const before = await SegurosAlfaCaso.find({})
  .select('direccionPredio ubicacionPredio')
  .lean();
const ubicadosAntes = before.filter(
  (c) =>
    Number.isFinite(c.ubicacionPredio?.lat) && Number.isFinite(c.ubicacionPredio?.lng)
).length;
const pendientesGeocodificables = before.filter((c) => {
  const hasCoords =
    Number.isFinite(c.ubicacionPredio?.lat) && Number.isFinite(c.ubicacionPredio?.lng);
  return !hasCoords && esDireccionPredioGeocodableAlfa(c.direccionPredio);
}).length;

console.log(
  JSON.stringify({
    total: before.length,
    ubicadosAntes,
    pendientesGeocodificables,
    limit,
    hasGoogleKey: Boolean(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY),
  })
);

const resumen = await geocodeCasosAlfaPendientes({ limit, force: false });
console.log('resumen', JSON.stringify(resumen, null, 2));

const after = await SegurosAlfaCaso.find({})
  .select('ubicacionPredio direccionPredio')
  .lean();
const ubicadosDespues = after.filter(
  (c) =>
    Number.isFinite(c.ubicacionPredio?.lat) && Number.isFinite(c.ubicacionPredio?.lng)
).length;
console.log(JSON.stringify({ ubicadosDespues, ganancia: ubicadosDespues - ubicadosAntes }));

await mongoose.disconnect();
