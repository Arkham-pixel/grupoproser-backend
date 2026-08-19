/**
 * Asigna a Ladys los consecutivos de su listado.
 * Uso: node scripts/asignarCasosLadysAlfa.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const AJ = 'Ladys Andrea Escalante Bossio';
const consecutivos = [
  'ALFA-2026-08-12',
  'ALFA-2026-08-17',
  'ALFA-2026-08-8',
  'ALFA-2026-08-13',
  'ALFA-2026-08-63',
  'ALFA-2026-08-62',
  'ALFA-2026-08-19',
  'ALFA-2026-08-219',
  'ALFA-2026-08-79',
  'ALFA-2026-08-52',
  'ALFA-2026-08-47',
  'ALFA-2026-08-36',
  'ALFA-2026-08-224',
  'ALFA-2026-08-45',
];

await mongoose.connect(process.env.MONGO_URI);
const col = mongoose.connection.db.collection('gsk3cAppsegurosAlfaCasos');

const encontrados = await col
  .find({ consecutivo: { $in: consecutivos } })
  .project({ consecutivo: 1, ajustador: 1 })
  .toArray();
const hallados = new Set(encontrados.map((c) => c.consecutivo));
const faltantes = consecutivos.filter((c) => !hallados.has(c));

const res = await col.updateMany(
  { consecutivo: { $in: consecutivos } },
  { $set: { ajustador: AJ, updatedAt: new Date() } }
);

const despues = await col
  .find({ consecutivo: { $in: consecutivos } })
  .project({ consecutivo: 1, ajustador: 1 })
  .toArray();
despues.sort((a, b) =>
  String(a.consecutivo).localeCompare(String(b.consecutivo), 'es', { numeric: true })
);

console.log(
  JSON.stringify(
    {
      pedidas: consecutivos.length,
      encontradas: encontrados.length,
      faltantes,
      matched: res.matchedCount,
      modified: res.modifiedCount,
      asignados: despues,
    },
    null,
    2
  )
);

await mongoose.disconnect();
