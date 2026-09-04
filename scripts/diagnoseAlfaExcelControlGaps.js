/**
 * Diagnostica casos con liquidación en ARNALD que no llegaron al Excel.
 * node scripts/diagnoseAlfaExcelControlGaps.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { liquidadorAlfaTieneCifras } from '../utils/valoresLiquidadorAlfa.js';

await mongoose.connect(process.env.MONGO_URI);

const conLiq = await SegurosAlfaCaso.find({
  liquidador: { $exists: true, $ne: null, $type: 'object' },
})
  .select(
    'consecutivo identificacion siniestro valorTotalPagar valorLiquidado controlSeguimientoExcel liquidador'
  )
  .lean();

const conCifras = conLiq.filter((c) => liquidadorAlfaTieneCifras(c.liquidador));
const conTotal = conCifras.filter((c) => Number(c.valorTotalPagar) > 0 || Number(c.valorLiquidado) > 0);

const ids = conTotal.map((c) => c._id);
const outbox = await AlfaExcelOutboundUpdate.find({
  caseId: { $in: ids },
})
  .select('caseId consecutivo status lastError lastErrorCode attempts updatedAt changes')
  .sort({ updatedAt: -1 })
  .lean();

const latestByCase = new Map();
for (const o of outbox) {
  const k = String(o.caseId);
  if (!latestByCase.has(k)) latestByCase.set(k, o);
}

const porEstado = {};
const huecos = [];
for (const c of conTotal) {
  const o = latestByCase.get(String(c._id));
  const st = o?.status || c.controlSeguimientoExcel?.status || 'sin_outbox';
  porEstado[st] = (porEstado[st] || 0) + 1;
  if (st !== 'synced' && st !== 'done') {
    if (huecos.length < 25) {
      huecos.push({
        consecutivo: c.consecutivo,
        identificacion: c.identificacion,
        valorTotalPagar: c.valorTotalPagar,
        outbox: o
          ? { status: o.status, code: o.lastErrorCode, error: o.lastError, attempts: o.attempts }
          : { status: st },
      });
    }
  }
}

const failed = await AlfaExcelOutboundUpdate.aggregate([
  { $match: { lastErrorCode: { $ne: null } } },
  { $group: { _id: '$lastErrorCode', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);

const pending = await AlfaExcelOutboundUpdate.countDocuments({
  status: { $in: ['pending', 'processing'] },
});

console.log(
  JSON.stringify(
    {
      conLiquidadorObj: conLiq.length,
      conCifras: conCifras.length,
      conTotalPagar: conTotal.length,
      outboxPorEstado: porEstado,
      colaPendiente: pending,
      erroresOutbox: failed,
      sampleHuecos: huecos,
    },
    null,
    2
  )
);

await mongoose.disconnect();
