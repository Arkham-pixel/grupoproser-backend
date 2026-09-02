/**
 * Quita de reserva (y reserva preventiva) el monto 18.147.313 copiado de
 * VR CUANTÍA PROBABLE del consolidado Detalle. Ese valor no es reserva BBVA
 * ni liquidado Proser.
 *
 * Uso: node scripts/limpiarReservaCuantiaProbableBbvaCat.js
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import mongoose from 'mongoose';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';

const CUANTIA_FALSA = 18147313;

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);
  const filtro = {
    $or: [{ reserva: CUANTIA_FALSA }, { valorReservaPreventivaPromedio: CUANTIA_FALSA }],
  };
  const unset = {
    $unset: { reserva: '', valorReservaPreventivaPromedio: '' },
  };

  const [cat, listado] = await Promise.all([
    BbvaCatCaso.updateMany(filtro, unset),
    BbvaCatListadoCaso.updateMany({ reserva: CUANTIA_FALSA }, { $unset: { reserva: '' } }),
  ]);

  const [catReserva, lstReserva, catInmueble, lstInmueble, catReclamado, lstReclamado] =
    await Promise.all([
      BbvaCatCaso.countDocuments({ reserva: { $gt: 0 } }),
      BbvaCatListadoCaso.countDocuments({ reserva: { $gt: 0 } }),
      BbvaCatCaso.countDocuments({ valorAseguradoInmueble: { $gt: 0 } }),
      BbvaCatListadoCaso.countDocuments({ valorAseguradoInmueble: { $gt: 0 } }),
      BbvaCatCaso.countDocuments({ valorReclamado: { $gt: 0 } }),
      BbvaCatListadoCaso.countDocuments({ valorReclamado: { $gt: 0 } }),
    ]);

  console.log(
    JSON.stringify(
      {
        cuantiaRetirada: CUANTIA_FALSA,
        catLimpiados: cat.modifiedCount,
        listadoLimpiados: listado.modifiedCount,
        despues: {
          catConReserva: catReserva,
          listadoConReserva: lstReserva,
          catConInmueble: catInmueble,
          listadoConInmueble: lstInmueble,
          catConReclamado: catReclamado,
          listadoConReclamado: lstReclamado,
        },
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
