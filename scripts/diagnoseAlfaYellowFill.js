import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';

const YELLOW = [
  'ajustador',
  'estado',
  'reserva',
  'valorReclamado',
  'valorLiquidado',
  'fechaInspeccion',
  'fechaUltimoDocumento',
  'fechaLlamada',
  'observaciones',
  'contactoAdicional',
  'notasInternas',
];

await mongoose.connect(process.env.MONGO_URI);
const casos = await SegurosAlfaCaso.find({})
  .select(YELLOW.join(' ') + ' consecutivo')
  .lean();

const filled = {};
for (const f of YELLOW) {
  filled[f] = casos.filter((c) => {
    const v = c[f];
    return v != null && String(v).trim() !== '';
  }).length;
}

const synced = await AlfaExcelOutboundUpdate.find({ status: 'synced' })
  .select('changes consecutivo updatedAt')
  .sort({ updatedAt: -1 })
  .limit(20)
  .lean();

const fieldHits = {};
for (const s of synced) {
  const ch = s.changes || {};
  for (const k of Object.keys(ch)) {
    fieldHits[k] = (fieldHits[k] || 0) + 1;
  }
}

const allSynced = await AlfaExcelOutboundUpdate.find({ status: 'synced' })
  .select('changes')
  .lean();
const allHits = {};
for (const s of allSynced) {
  for (const k of Object.keys(s.changes || {})) {
    allHits[k] = (allHits[k] || 0) + 1;
  }
}

console.log(
  JSON.stringify(
    {
      totalCasos: casos.length,
      camposAmarillosLlenosEnArnald: filled,
      outboundSyncedDocs: allSynced.length,
      camposEnOutboundSynced: allHits,
    },
    null,
    2
  )
);
await mongoose.disconnect();
