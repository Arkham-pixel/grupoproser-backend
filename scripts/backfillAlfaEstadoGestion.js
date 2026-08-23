/**
 * Backfill estadoGestion en casos Alfa existentes.
 * node scripts/backfillAlfaEstadoGestion.js
 * node scripts/backfillAlfaEstadoGestion.js --apply
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { deriveEstadoGestionFromCaso, canonicalEstadoGestion } from '../config/alfaExcelStatuses.js';

const apply = process.argv.includes('--apply');

await mongoose.connect(process.env.MONGO_URI);
const casos = await SegurosAlfaCaso.find(
  {},
  { estado: 1, estadoGestion: 1, fechaInspeccion: 1, consecutivo: 1 }
).lean();

let toUpdate = 0;
const samples = [];
for (const c of casos) {
  const current = canonicalEstadoGestion(c.estadoGestion);
  const derived = deriveEstadoGestionFromCaso(c);
  const next = current || derived;
  if (current === next) continue;
  toUpdate += 1;
  if (samples.length < 8) {
    samples.push({
      consecutivo: c.consecutivo,
      estado: c.estado,
      before: c.estadoGestion || null,
      after: next,
    });
  }
  if (apply) {
    await SegurosAlfaCaso.updateOne({ _id: c._id }, { $set: { estadoGestion: next } });
  }
}

console.log(
  JSON.stringify(
    { dryRun: !apply, total: casos.length, toUpdate, samples },
    null,
    2
  )
);
await mongoose.disconnect();
