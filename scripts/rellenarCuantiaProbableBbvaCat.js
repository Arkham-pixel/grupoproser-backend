/**
 * Rellena cuantía probable BBVA (valorEstimadoAseguradora = 18.147.313)
 * solo en casos que no la tienen (vacío, null o <= 0).
 *
 * Uso:
 *   node scripts/rellenarCuantiaProbableBbvaCat.js
 *   node scripts/rellenarCuantiaProbableBbvaCat.js --apply
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import mongoose from 'mongoose';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';

const ESTIMADO = 18147313;
const APPLY = process.argv.includes('--apply');

const FILTRO_SIN = {
  $or: [
    { valorEstimadoAseguradora: { $exists: false } },
    { valorEstimadoAseguradora: null },
    { valorEstimadoAseguradora: '' },
    { valorEstimadoAseguradora: { $lte: 0 } },
  ],
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);

  const [catPend, listPend, catOk, listOk] = await Promise.all([
    BbvaCatCaso.countDocuments(FILTRO_SIN),
    BbvaCatListadoCaso.countDocuments(FILTRO_SIN),
    BbvaCatCaso.countDocuments({ valorEstimadoAseguradora: ESTIMADO }),
    BbvaCatListadoCaso.countDocuments({ valorEstimadoAseguradora: ESTIMADO }),
  ]);

  let catMod = 0;
  let listMod = 0;
  if (APPLY) {
    const set = { $set: { valorEstimadoAseguradora: ESTIMADO, updatedAt: new Date() } };
    const [cat, list] = await Promise.all([
      BbvaCatCaso.updateMany(FILTRO_SIN, set),
      BbvaCatListadoCaso.updateMany(FILTRO_SIN, set),
    ]);
    catMod = cat.modifiedCount || 0;
    listMod = list.modifiedCount || 0;
  }

  const [catOkAfter, listOkAfter] = APPLY
    ? await Promise.all([
        BbvaCatCaso.countDocuments({ valorEstimadoAseguradora: ESTIMADO }),
        BbvaCatListadoCaso.countDocuments({ valorEstimadoAseguradora: ESTIMADO }),
      ])
    : [catOk, listOk];

  console.log(
    JSON.stringify(
      {
        modo: APPLY ? 'APPLY' : 'DRY-RUN',
        estimado: ESTIMADO,
        pendientesCat: catPend,
        pendientesListado: listPend,
        actualizadosCat: catMod,
        actualizadosListado: listMod,
        conEstimadoCat: catOkAfter,
        conEstimadoListado: listOkAfter,
        nota: APPLY
          ? 'Solo se rellenaron huecos; no se pisaron valores > 0 distintos.'
          : 'Sin cambios. Pase --apply para escribir.',
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
