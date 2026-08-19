import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import EquidadFdmExcelOutboundUpdate from '../models/EquidadFdmExcelOutboundUpdate.js';
import { runEquidadFdmExcelOutboundCycle } from '../services/equidadFdmExcelOutboundService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);
await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const pareceDireccion = (v) => {
  const s = String(v || '').trim();
  if (!s) return false;
  if (/\(sistema\s*osiris\)/i.test(s)) return true;
  if (/^(CLL|CRA|CR |CALLE|CARRERA|MZ|MANZANA|SUBA|DIAG|AV |AVENIDA|TRANSVERSAL|TV )/i.test(s)) {
    return true;
  }
  if (/#\s*\d/.test(s) && /\d/.test(s) && s.length > 8) return true;
  return false;
};

const malos = await EquidadFdmCaso.find({
  ajustador: { $nin: [null, ''] },
}).select('consecutivo nombre cedula ajustador').lean();

let limpiados = 0;
for (const c of malos) {
  if (!pareceDireccion(c.ajustador)) continue;
  await EquidadFdmCaso.updateOne({ _id: c._id }, { $set: { ajustador: null } });
  await EquidadFdmExcelOutboundUpdate.deleteMany({
    casoId: c._id,
    status: { $in: ['pending', 'processing', 'error'] },
  });
  limpiados += 1;
  console.log('limpiado', c.consecutivo, c.ajustador);
}
console.log({ limpiados });

// Reset stuck processing + reintentar pending de ajustadores reales
await EquidadFdmExcelOutboundUpdate.updateMany(
  { status: 'processing' },
  { $set: { status: 'pending', nextRetryAt: null } }
);
await EquidadFdmExcelOutboundUpdate.updateMany(
  { status: 'pending', lastError: /LOCKED/i },
  { $set: { nextRetryAt: null, attempts: 0 } }
);

const conAj = await EquidadFdmCaso.find({
  ajustador: { $nin: [null, ''] },
  evento: /TERREMOTO/i,
})
  .select('_id consecutivo cedula ajustador')
  .lean();

for (const caso of conAj) {
  if (pareceDireccion(caso.ajustador)) continue;
  const existing = await EquidadFdmExcelOutboundUpdate.findOne({
    casoId: caso._id,
    status: 'pending',
  });
  if (existing) {
    existing.changes = {
      ...(existing.changes || {}),
      ajustador: { from: null, to: caso.ajustador },
    };
    existing.nextRetryAt = null;
    await existing.save();
  } else {
    await EquidadFdmExcelOutboundUpdate.create({
      casoId: caso._id,
      consecutivo: caso.consecutivo,
      cedula: caso.cedula,
      status: 'pending',
      changes: { ajustador: { from: null, to: caso.ajustador } },
    });
  }
}

const summary = await runEquidadFdmExcelOutboundCycle({ batchSize: 30 });
console.log('cycle', summary);

const left = await EquidadFdmExcelOutboundUpdate.find({
  status: { $in: ['pending', 'processing', 'error'] },
})
  .select('consecutivo status lastError changes')
  .lean();
console.log(
  'left',
  left.map((x) => ({
    consecutivo: x.consecutivo,
    status: x.status,
    lastError: x.lastError,
    fields: Object.keys(x.changes || {}),
  }))
);

await mongoose.disconnect();
