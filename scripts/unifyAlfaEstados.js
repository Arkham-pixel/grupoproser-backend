/**
 * Unifica estado + estadoGestion Alfa a catálogos oficiales (ejes independientes).
 * NO deriva gestión desde siniestro.
 *
 *   node scripts/unifyAlfaEstados.js
 *   node scripts/unifyAlfaEstados.js --apply
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  homologarEstadoGestionAlfa,
  homologarEstadoSiniestroAlfa,
} from '../config/alfaExcelStatuses.js';

const apply = process.argv.includes('--apply');

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);
const casos = await SegurosAlfaCaso.find(
  {},
  { estado: 1, estadoGestion: 1, liquidador: 1, fechaAceptacionLiquidacion: 1, consecutivo: 1 }
).lean();

let toUpdate = 0;
const samples = [];
const countsEstado = {};
const countsGestion = {};

for (const c of casos) {
  const nextEstado = homologarEstadoSiniestroAlfa(c.estado, {
    liquidador: c.liquidador,
    fechaAceptacionLiquidacion: c.fechaAceptacionLiquidacion,
  });
  const nextGestion = homologarEstadoGestionAlfa(c.estadoGestion || c.estado) || 'EN GESTIÓN';

  countsEstado[nextEstado] = (countsEstado[nextEstado] || 0) + 1;
  countsGestion[nextGestion] = (countsGestion[nextGestion] || 0) + 1;

  if (c.estado === nextEstado && (c.estadoGestion || '') === nextGestion) continue;
  toUpdate += 1;
  if (samples.length < 15) {
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
    {
      dryRun: !apply,
      total: casos.length,
      toUpdate,
      countsEstado,
      countsGestion,
      samples,
      hint: apply ? 'Mongo actualizado' : 'Use --apply para escribir en Mongo',
    },
    null,
    2
  )
);
await mongoose.disconnect();
