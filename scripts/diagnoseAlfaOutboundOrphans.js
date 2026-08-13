import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';

await mongoose.connect(process.env.MONGO_URI);
const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
const cases = await SegurosAlfaCaso.find({ updatedAt: { $gte: since } })
  .select(
    'consecutivo updatedAt controlSeguimientoExcel reserva fechaInspeccion estado fechaUltimoDocumento valorLiquidado'
  )
  .sort({ updatedAt: -1 })
  .lean();

console.log('Casos updated last 2h:', cases.length);
for (const c of cases) {
  const outs = await AlfaExcelOutboundUpdate.find({
    caseId: c._id,
    createdAt: { $gte: new Date(new Date(c.updatedAt).getTime() - 60_000) },
  })
    .sort({ createdAt: -1 })
    .limit(3)
    .select('status createdAt changes sourceExcel.columnsWritten')
    .lean();
  console.log(
    JSON.stringify({
      id: String(c._id),
      consecutivo: c.consecutivo,
      updatedAt: c.updatedAt,
      sync: c.controlSeguimientoExcel,
      fields: {
        reserva: c.reserva,
        fechaInspeccion: c.fechaInspeccion,
        estado: c.estado,
        fechaUltimoDocumento: c.fechaUltimoDocumento,
        valorLiquidado: c.valorLiquidado,
      },
      outboxesNearUpdate: outs.map((o) => ({
        status: o.status,
        createdAt: o.createdAt,
        fields: Object.keys(o.changes || {}),
        cols: o.sourceExcel?.columnsWritten,
      })),
    })
  );
}

const openCount = await AlfaExcelOutboundUpdate.countDocuments({
  status: { $in: ['pending', 'processing', 'failed'] },
});
console.log('open outbox count:', openCount);
const lastOut = await AlfaExcelOutboundUpdate.findOne()
  .sort({ createdAt: -1 })
  .select('createdAt status consecutivo')
  .lean();
console.log('last outbox:', lastOut);

// Check if any case updated AFTER last outbox without new outbox
if (lastOut) {
  const orphans = cases.filter(
    (c) =>
      new Date(c.updatedAt) > new Date(lastOut.createdAt) &&
      (!c.controlSeguimientoExcel ||
        c.controlSeguimientoExcel.status === 'idle' ||
        !c.controlSeguimientoExcel.lastOutboundId)
  );
  console.log(
    'cases updated after last outbox without clear sync link:',
    orphans.map((c) => c.consecutivo)
  );
}

await mongoose.disconnect();
