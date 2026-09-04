/**
 * Cruza cédulas pegadas del Excel vs Mongo control liquidación + outbox.
 * node scripts/auditAlfaExcelPasteGaps.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { liquidadorAlfaTieneCifras } from '../utils/valoresLiquidadorAlfa.js';

const IDS = [
  '1130618036',
  '6106582',
  '1130602906',
  '14836163',
  '94531730',
  '1144126605',
  '1151965576',
  '409649',
  '66926240',
  '94308238',
  '514099',
  '1144094958',
  '16729830',
  '66841587',
  '14997944',
  '67022547',
  '14471219',
  '1061726010',
  '7543170',
  '16847808',
  '55178062',
  '1093765925',
  '31898845',
  '1130615893',
  '94507267',
  '1130621423',
  '31323610',
  '16689403',
  '42159204',
  '4647780',
  '1061754534',
  '1144078777',
  '1144027821',
  '31571105',
  '94060113',
  '1143925249',
  '80231106',
  '1061713608',
  '1144057937',
  '37947805',
];

await mongoose.connect(process.env.MONGO_URI);

const casos = await SegurosAlfaCaso.find({ identificacion: { $in: IDS } })
  .select(
    'consecutivo identificacion asegurado valorLiquidado reserva liquidadoCoberturaTerremo deducibleTerremoto valorLiquidacionCoberturasAdicionales deducibleCoberturasAdicionales valorTotalPagar valorReclamado liquidador controlSeguimientoExcel'
  )
  .lean();

const byId = new Map(casos.map((c) => [String(c.identificacion), c]));
const caseIds = casos.map((c) => c._id);
const outbox = await AlfaExcelOutboundUpdate.find({ caseId: { $in: caseIds } })
  .sort({ updatedAt: -1 })
  .select('caseId consecutivo status lastErrorCode updatedAt sourceExcel.columnsWritten')
  .lean();
const latest = new Map();
for (const o of outbox) {
  const k = String(o.caseId);
  if (!latest.has(k)) latest.set(k, o);
}

const rows = [];
for (const id of IDS) {
  const c = byId.get(id);
  if (!c) {
    rows.push({ id, problem: 'NO_EN_MONGO' });
    continue;
  }
  const o = latest.get(String(c._id));
  const tieneCifras = liquidadorAlfaTieneCifras(c.liquidador);
  const controlOk =
    Number(c.valorTotalPagar) > 0 ||
    Number(c.liquidadoCoberturaTerremo) > 0 ||
    Number(c.valorLiquidado) > 0;
  rows.push({
    id,
    consecutivo: c.consecutivo,
    asegurado: c.asegurado,
    tieneCifras,
    controlOk,
    mongo: {
      reserva: c.reserva ?? null,
      valorLiquidado: c.valorLiquidado ?? null,
      liquidadoCoberturaTerremo: c.liquidadoCoberturaTerremo ?? null,
      deducibleTerremoto: c.deducibleTerremoto ?? null,
      adicionales: c.valorLiquidacionCoberturasAdicionales ?? null,
      dedAdic: c.deducibleCoberturasAdicionales ?? null,
      totalPagar: c.valorTotalPagar ?? null,
      reclamado: c.valorReclamado ?? null,
    },
    outbox: o
      ? {
          status: o.status,
          code: o.lastErrorCode || null,
          cols: o.sourceExcel?.columnsWritten || [],
        }
      : null,
  });
}

const debeEstarEnExcel = rows.filter((r) => r.controlOk);
const syncOk = debeEstarEnExcel.filter((r) => r.outbox?.status === 'synced');
const pendientes = debeEstarEnExcel.filter((r) => r.outbox?.status !== 'synced');
const sinLiquidar = rows.filter((r) => !r.controlOk && r.consecutivo);

console.log(
  JSON.stringify(
    {
      totalPegados: IDS.length,
      conControlEnMongo: debeEstarEnExcel.length,
      outboxSynced: syncOk.length,
      outboxNoSynced: pendientes.map((p) => ({
        consecutivo: p.consecutivo,
        id: p.id,
        status: p.outbox?.status || 'sin_outbox',
        code: p.outbox?.code,
        totalPagar: p.mongo.totalPagar,
      })),
      sinControlMongo: sinLiquidar.map((p) => ({
        consecutivo: p.consecutivo,
        id: p.id,
        reclamado: p.mongo.reclamado,
        tieneCifras: p.tieneCifras,
      })),
    },
    null,
    2
  )
);

await mongoose.disconnect();
