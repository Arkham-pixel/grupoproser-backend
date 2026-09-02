/**
 * Carga VR CUANTÍA PROBABLE como valor estimado de la aseguradora (por caso).
 * No escribe en reserva (reserva BBVA vs reserva ajustador van aparte).
 *
 * Uso: node scripts/cargarValorEstimadoAseguradoraBbvaCat.js
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import mongoose from 'mongoose';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';

const ESTIMADO = 18147313;
const EXCLUIR = ['100017576'];

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);
  const filtro = {
    siniestro: { $nin: EXCLUIR },
    zc: { $nin: EXCLUIR },
  };
  const set = { $set: { valorEstimadoAseguradora: ESTIMADO } };
  const [cat, listado] = await Promise.all([
    BbvaCatCaso.updateMany(filtro, set),
    BbvaCatListadoCaso.updateMany(filtro, set),
  ]);
  const [catN, lstN] = await Promise.all([
    BbvaCatCaso.countDocuments({ valorEstimadoAseguradora: ESTIMADO }),
    BbvaCatListadoCaso.countDocuments({ valorEstimadoAseguradora: ESTIMADO }),
  ]);
  console.log(
    JSON.stringify(
      {
        estimadoPorCaso: ESTIMADO,
        catActualizados: cat.modifiedCount,
        listadoActualizados: listado.modifiedCount,
        catConEstimado: catN,
        listadoConEstimado: lstN,
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
