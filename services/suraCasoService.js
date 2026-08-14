/**
 * Lógica compartida de casos Sura (creación / consecutivo).
 */

import mongoose from 'mongoose';
import SegurosSuraCaso from '../models/SegurosSuraCaso.js';

const COUNTER_ID = 'seguros_sura_consecutivo';

const ConsecutivoCounterSchema = new mongoose.Schema(
  {
    _id: { type: String },
    seq: { type: Number, default: 0 },
  },
  { collection: 'sura_counters' }
);

const SuraCounter =
  mongoose.models.SuraCounter || mongoose.model('SuraCounter', ConsecutivoCounterSchema);

let counterSeeded = false;

async function seedCounterFromExisting() {
  if (counterSeeded) return;
  const patron = /^SURA-(\d{4})-(\d{2})-(\d+)$/i;
  const registros = await SegurosSuraCaso.find({
    consecutivo: { $exists: true, $nin: [null, ''] },
  })
    .select('consecutivo')
    .lean();
  let maxSecuencial = 0;
  for (const reg of registros) {
    const match = String(reg.consecutivo || '').trim().match(patron);
    if (match?.[3]) {
      const n = parseInt(match[3], 10);
      if (!Number.isNaN(n) && n > maxSecuencial) maxSecuencial = n;
    }
  }
  await SuraCounter.findOneAndUpdate(
    { _id: COUNTER_ID },
    { $max: { seq: maxSecuencial } },
    { upsert: true }
  );
  counterSeeded = true;
}

/** Genera SURA-YYYY-MM-N de forma atómica. */
export async function generarConsecutivoSura() {
  await seedCounterFromExisting();
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const doc = await SuraCounter.findOneAndUpdate(
    { _id: COUNTER_ID },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `SURA-${año}-${mes}-${doc.seq}`;
}
