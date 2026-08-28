/**
 * Unifica Cali / Santiago de Cali → CALI en BBVA CAT (listado + inspección).
 *
 * Uso: node scripts/normalizeBbvaCatCiudadCali.js
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import mongoose from 'mongoose';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';

const FILTRO_CALI = {
  ciudad: { $regex: /^\s*(santiago\s+de\s+)?cali(\s+valle(\s+del\s+cauca)?)?\b/i },
};

async function unificar(Model, nombre) {
  const antes = await Model.aggregate([
    { $match: FILTRO_CALI },
    { $group: { _id: '$ciudad', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  const res = await Model.updateMany(FILTRO_CALI, { $set: { ciudad: 'CALI', updatedAt: new Date() } });
  const despues = await Model.aggregate([
    { $match: FILTRO_CALI },
    { $group: { _id: '$ciudad', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  return { coleccion: nombre, antes, modified: res.modifiedCount, matched: res.matchedCount, despues };
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 20000,
});

const listado = await unificar(BbvaCatListadoCaso, 'listado');
const cat = await unificar(BbvaCatCaso, 'cat');
console.log(JSON.stringify({ listado, cat }, null, 2));
await mongoose.disconnect();
