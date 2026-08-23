/**
 * Unifica estado Alfa al catálogo único (barra de estados).
 * node scripts/unifyAlfaEstados.js
 * node scripts/unifyAlfaEstados.js --apply
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  homologarEstadoAlfa,
  estadoGestionDesdeEstadoAlfa,
} from '../config/alfaExcelStatuses.js';

const apply = process.argv.includes('--apply');

await mongoose.connect(process.env.MONGO_URI);
const casos = await SegurosAlfaCaso.find(
  {},
  { estado: 1, estadoGestion: 1, fechaInspeccion: 1, consecutivo: 1 }
).lean();

let toUpdate = 0;
const samples = [];
const counts = {};

for (const c of casos) {
  const nextEstado = homologarEstadoAlfa(c.estado, {
    fechaInspeccion: c.fechaInspeccion,
    estadoGestion: c.estadoGestion,
  });
  const nextGestion = estadoGestionDesdeEstadoAlfa(nextEstado);
  counts[nextEstado] = (counts[nextEstado] || 0) + 1;

  if (c.estado === nextEstado && (c.estadoGestion || '') === nextGestion) continue;
  toUpdate += 1;
  if (samples.length < 10) {
    samples.push({
      consecutivo: c.consecutivo,
      beforeEstado: c.estado,
      beforeGestion: c.estadoGestion,
      afterEstado: nextEstado,
      afterGestion: nextGestion,
    });
  }
  if (apply) {
    await SegurosAlfaCaso.updateOne(
      { _id: c._id },
      { $set: { estado: nextEstado, estadoGestion: nextGestion } }
    );
  }
}

console.log(
  JSON.stringify(
    { dryRun: !apply, total: casos.length, toUpdate, counts, samples },
    null,
    2
  )
);
await mongoose.disconnect();
