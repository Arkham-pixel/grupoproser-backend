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

const conAjustador = await EquidadFdmCaso.find({
  ajustador: { $nin: [null, ''] },
})
  .select('consecutivo nombre cedula ajustador updatedAt')
  .sort({ updatedAt: -1 })
  .limit(25)
  .lean();
console.log('casosConAjustador', conAjustador.length);
console.log(JSON.stringify(conAjustador, null, 2));

const byStatus = await EquidadFdmExcelOutboundUpdate.aggregate([
  { $group: { _id: '$status', n: { $sum: 1 } } },
]);
console.log('outboundByStatus', byStatus);

const recent = await EquidadFdmExcelOutboundUpdate.find({})
  .sort({ updatedAt: -1 })
  .limit(12)
  .lean();
console.log(
  'recentOutbound',
  recent.map((p) => ({
    status: p.status,
    consecutivo: p.consecutivo,
    fields: Object.keys(p.changes || {}),
    lastError: p.lastError,
    attempts: p.attempts,
    updatedAt: p.updatedAt,
  }))
);

// Encolar ajustador para todos los que lo tienen y aún no hay pending
let enqueued = 0;
for (const caso of conAjustador) {
  const existing = await EquidadFdmExcelOutboundUpdate.findOne({
    casoId: caso._id,
    status: 'pending',
  });
  if (existing) {
    existing.changes = {
      ...(existing.changes || {}),
      ajustador: { from: null, to: caso.ajustador },
    };
    await existing.save();
    enqueued += 1;
    continue;
  }
  await EquidadFdmExcelOutboundUpdate.create({
    casoId: caso._id,
    consecutivo: caso.consecutivo,
    cedula: caso.cedula,
    status: 'pending',
    changes: { ajustador: { from: null, to: caso.ajustador } },
  });
  enqueued += 1;
}
console.log('enqueued', enqueued);

const summary = await runEquidadFdmExcelOutboundCycle({ batchSize: 50 });
console.log('cycle', summary);

await mongoose.disconnect();
