/**
 * Cruza fechaInspeccion en ARNALD vs outbound Excel.
 * node scripts/diagnoseAlfaFechaInspeccionGap.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';

await mongoose.connect(process.env.MONGO_URI);

const casos = await SegurosAlfaCaso.find({
  fechaInspeccion: { $exists: true, $nin: [null, ''] },
})
  .select(
    'consecutivo identificacion asegurado fechaInspeccion controlSeguimientoExcel updatedAt'
  )
  .sort({ fechaInspeccion: 1 })
  .lean();

const outbound = await AlfaExcelOutboundUpdate.find({
  $or: [
    { 'changes.fechaInspeccion': { $exists: true } },
    { field: 'fechaInspeccion' },
  ],
})
  .select('caseId consecutivo status changes excelRowNumber lastError attempts updatedAt')
  .lean();

const byCase = new Map();
for (const o of outbound) {
  const id = String(o.caseId || '');
  if (!id) continue;
  const list = byCase.get(id) || [];
  list.push(o);
  byCase.set(id, list);
}

const rows = casos.map((c) => {
  const outs = byCase.get(String(c._id)) || [];
  const synced = outs.filter((o) => o.status === 'synced');
  const failed = outs.filter((o) => o.status === 'failed');
  const pending = outs.filter((o) =>
    ['pending', 'queued', 'processing', 'retry'].includes(o.status)
  );
  const hasFechaChange = outs.some((o) => o.changes?.fechaInspeccion);
  return {
    consecutivo: c.consecutivo,
    id: c.identificacion,
    asegurado: String(c.asegurado || '').slice(0, 40),
    fechaInspeccion: c.fechaInspeccion,
    csStatus: c.controlSeguimientoExcel?.status || null,
    csError: c.controlSeguimientoExcel?.lastError || null,
    outboundDocs: outs.length,
    synced: synced.length,
    failed: failed.length,
    pending: pending.length,
    hasFechaInChanges: hasFechaChange,
    lastOutboundStatus: outs[0]?.status || null,
    lastOutboundError: outs.find((o) => o.lastError)?.lastError || null,
  };
});

const sinOutboundFecha = rows.filter((r) => !r.hasFechaInChanges && r.synced === 0);
const conSynced = rows.filter((r) => r.synced > 0 || r.hasFechaInChanges);
const failedOnly = rows.filter((r) => r.failed > 0 && r.synced === 0);

// También: outbound synced con fechaInspeccion cuyo caso ya no tiene fecha
const orphanOutbound = [];
for (const o of outbound) {
  if (!o.changes?.fechaInspeccion) continue;
  if (o.status !== 'synced') continue;
  const still = casos.some((c) => String(c._id) === String(o.caseId));
  if (!still) {
    orphanOutbound.push({
      consecutivo: o.consecutivo,
      status: o.status,
      updatedAt: o.updatedAt,
    });
  }
}

console.log(
  JSON.stringify(
    {
      casosConFechaInspeccionArnald: casos.length,
      outboundDocsConCampoFecha: outbound.length,
      outboundSyncedConFecha: outbound.filter(
        (o) => o.status === 'synced' && o.changes?.fechaInspeccion
      ).length,
      resumenFilas: {
        total: rows.length,
        conEvidenciaOutbound: conSynced.length,
        sinOutboundFecha: sinOutboundFecha.length,
        failedOnly: failedOnly.length,
      },
      sinOutboundFecha,
      failedOnly,
      todas: rows,
    },
    null,
    2
  )
);

await mongoose.disconnect();
