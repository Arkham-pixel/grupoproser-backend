/**
 * Elimina el Liquidador PDF viejo del caso listado 100017619
 * (el JSON ya tiene el valor correcto; el binario del archivero quedó desfasado).
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') dns.setServers(['8.8.8.8', '1.1.1.1']);

const STRO = '100017619';

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 15000,
});
const db = mongoose.connection.db;
const col = db.collection('gsk3cAppbbvaCatListadoCasos');
const caso = await col.findOne({ siniestro: STRO });
if (!caso) {
  console.error('Caso no encontrado');
  process.exit(1);
}

const antes = (caso.archivos || []).filter((a) =>
  /liquidador_bbva_cat/i.test(String(a.nombreOriginal || a.nombre || ''))
);
const res = await col.updateOne(
  { _id: caso._id },
  {
    $pull: {
      archivos: {
        nombreOriginal: { $regex: /liquidador_bbva_cat/i },
      },
    },
    $set: { updatedAt: new Date() },
  }
);
// También por nombre si el campo es `nombre`
await col.updateOne(
  { _id: caso._id },
  {
    $pull: {
      archivos: {
        nombre: { $regex: /liquidador_bbva_cat/i },
      },
    },
  }
);

const despues = await col.findOne({ _id: caso._id }, { projection: { archivos: 1 } });
const quedan = (despues.archivos || []).filter((a) =>
  /liquidador|informe_unico/i.test(String(a.nombreOriginal || a.nombre || ''))
);
console.log(
  JSON.stringify(
    {
      quitados: antes.map((a) => ({
        id: String(a._id),
        n: a.nombreOriginal || a.nombre,
        e: a.etiqueta,
      })),
      modified: res.modifiedCount,
      quedanDocs: quedan.map((a) => ({
        n: a.nombreOriginal || a.nombre,
        e: a.etiqueta,
      })),
      hint: 'Abre el liquidador del caso y pulsa Guardar o PDF para subir la versión nueva.',
    },
    null,
    2
  )
);
await mongoose.disconnect();
