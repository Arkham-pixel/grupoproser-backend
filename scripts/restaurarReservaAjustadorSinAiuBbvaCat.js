/**
 * Devuelve valorLiquidado a lo que tenía antes de meter AIU 25% en cada caso.
 * Ese 25% se ve en el expediente; no entra en el total del dashboard.
 *
 * Uso: node scripts/restaurarReservaAjustadorSinAiuBbvaCat.js
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import mongoose from 'mongoose';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';

/** zc → reserva previa (null = quitar el campo) */
const PREVIA_POR_ZC = {
  '100017436': null,
  '100017458': 0,
  '100017461': null,
  '100017462': 47136310,
  '100017488': null,
  '100017492': 2914734,
  '100017501': 1679728,
  '100017533': null,
  '100017547': 1242862,
  '100017566': 704742,
  '100017587': 7335308,
  '100017595': 5713599,
  '100017597': null,
  '100017620': 0,
  '100017637': 1811651,
  '100017716': null,
  '100017751': 17622369,
  '100017838': 52795903,
  '100017846': 6782938,
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 20000,
  });
  const zcs = Object.keys(PREVIA_POR_ZC);
  const docs = await BbvaCatListadoCaso.find({ zc: { $in: zcs } }).select(
    'consecutivo zc asegurado valorLiquidado'
  );
  const resumen = { actualizados: 0, sumaReserva: 0, detalle: [] };
  for (const doc of docs) {
    const previa = PREVIA_POR_ZC[String(doc.zc)];
    if (previa == null) {
      await BbvaCatListadoCaso.updateOne({ _id: doc._id }, { $unset: { valorLiquidado: 1 } });
      resumen.actualizados += 1;
      resumen.detalle.push({ zc: doc.zc, valorLiquidado: null });
      continue;
    }
    await BbvaCatListadoCaso.updateOne({ _id: doc._id }, { $set: { valorLiquidado: previa } });
    resumen.actualizados += 1;
    if (previa > 0) resumen.sumaReserva += previa;
    resumen.detalle.push({ zc: doc.zc, valorLiquidado: previa });
  }
  console.log(JSON.stringify(resumen, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
