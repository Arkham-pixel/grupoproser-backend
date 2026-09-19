/**
 * Rellena fechaLiquidado en casos Alfa que ya tienen liquidador con contenido
 * y aún no tienen fecha.
 *
 * Fuente de fecha (mejor proxy disponible):
 * 1) updatedAt del caso
 * 2) createdAt
 *
 * Uso:
 *   node scripts/backfillAlfaFechaLiquidadoDesdeLiquidador.js
 *   node scripts/backfillAlfaFechaLiquidadoDesdeLiquidador.js --apply
 *   node scripts/backfillAlfaFechaLiquidadoDesdeLiquidador.js --apply --limit=50
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { scoreContenidoLiquidadorNsr } from '../utils/protegerPresupuestoNsr10.js';

const apply = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 0) : 0;

function diaLocalDesdeDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function vaciaFecha(v) {
  if (v == null || v === '') return true;
  if (v instanceof Date && Number.isNaN(v.getTime())) return true;
  return false;
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);

const filtro = {
  $and: [
    { liquidador: { $exists: true, $ne: null } },
    {
      $or: [
        { fechaLiquidado: { $exists: false } },
        { fechaLiquidado: null },
        { fechaLiquidado: '' },
      ],
    },
  ],
};

const query = SegurosAlfaCaso.find(filtro)
  .select('consecutivo liquidador fechaLiquidado updatedAt createdAt estado')
  .lean();
if (limit) query.limit(limit);

const candidatos = await query;
let toUpdate = 0;
let sinContenido = 0;
const samples = [];

for (const c of candidatos) {
  if (scoreContenidoLiquidadorNsr(c.liquidador) <= 0) {
    sinContenido += 1;
    continue;
  }
  if (!vaciaFecha(c.fechaLiquidado)) continue;

  const fecha = diaLocalDesdeDate(c.updatedAt) || diaLocalDesdeDate(c.createdAt);
  if (!fecha) continue;

  toUpdate += 1;
  if (samples.length < 12) {
    samples.push({
      consecutivo: c.consecutivo,
      estado: c.estado || null,
      fechaLiquidado: fecha.toISOString().slice(0, 10),
      desde: c.updatedAt ? 'updatedAt' : 'createdAt',
    });
  }

  if (apply) {
    await SegurosAlfaCaso.updateOne(
      { _id: c._id, $or: [{ fechaLiquidado: null }, { fechaLiquidado: { $exists: false } }, { fechaLiquidado: '' }] },
      { $set: { fechaLiquidado: fecha } }
    );
  }
}

console.log(
  JSON.stringify(
    {
      dryRun: !apply,
      candidatos: candidatos.length,
      sinContenidoLiquidador: sinContenido,
      toUpdate,
      samples,
      hint: apply
        ? 'Aplicado.'
        : 'Dry-run. Para escribir: node scripts/backfillAlfaFechaLiquidadoDesdeLiquidador.js --apply',
    },
    null,
    2
  )
);

await mongoose.disconnect();
