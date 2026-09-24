/**
 * Sanea valorAseguradoInmueble / valorAseguradoSid / valorAseguradoContenidos
 * con centavos concatenados (≥ 1.000 millones) vía pesosOficialesAlfa.
 *
 * node scripts/repairAlfaValorAseguradoInflado.mjs
 * node scripts/repairAlfaValorAseguradoInflado.mjs --dry-run
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { pesosOficialesAlfa } from '../utils/alfaExcelNormalize.js';

const DRY = process.argv.includes('--dry-run');
const FIELDS = ['valorAseguradoInmueble', 'valorAseguradoSid', 'valorAseguradoContenidos'];

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 25000 });

const q = {
  $or: FIELDS.map((f) => ({ [f]: { $gte: 1_000_000_000 } })),
};
const casos = await SegurosAlfaCaso.find(q)
  .select(['consecutivo', 'identificacion', 'asegurado', ...FIELDS, 'liquidador'].join(' '))
  .lean();

console.log(DRY ? 'DRY-RUN' : 'APPLY', 'candidatos', casos.length);

let patched = 0;
for (const caso of casos) {
  const patch = {};
  for (const f of FIELDS) {
    const cur = caso[f];
    if (cur == null || !(Number(cur) >= 1_000_000_000)) continue;
    const san = pesosOficialesAlfa(cur, caso.identificacion);
    if (san == null || Number(san) === Number(cur)) continue;
    // No escribir basura que sigue ≥ 1.000M tras el saneo (datos irrecuperables).
    if (Math.abs(Number(san)) >= 1_000_000_000) {
      console.log(
        JSON.stringify({
          skip: 'sigue_inflado',
          consecutivo: caso.consecutivo,
          field: f,
          cur,
          san,
        })
      );
      continue;
    }
    patch[f] = san;
  }

  const enc = caso.liquidador?.encabezado;
  const liqSet = {};
  if (enc && typeof enc === 'object') {
    for (const f of ['valorAseguradoInmueble', 'valorAseguradoSid', 'valorAseguradoContenidos']) {
      const cur = enc[f];
      if (cur == null || Number(cur) < 1_000_000_000) continue;
      const san = pesosOficialesAlfa(cur, caso.identificacion);
      if (san == null || Number(san) === Number(cur)) continue;
      liqSet[`liquidador.encabezado.${f}`] = san;
    }
  }

  if (!Object.keys(patch).length && !Object.keys(liqSet).length) continue;

  patched += 1;
  console.log(
    JSON.stringify({
      consecutivo: caso.consecutivo,
      id: caso.identificacion,
      patch,
      liqSet,
    })
  );

  if (DRY) continue;
  await SegurosAlfaCaso.updateOne({ _id: caso._id }, { $set: { ...patch, ...liqSet } });
}

console.log('patched', patched);
await mongoose.disconnect();
