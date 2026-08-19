/**
 * Detalle filas Excel outbound para fechaInspeccion.
 * node scripts/diagnoseAlfaFechaInspeccionRows.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';

await mongoose.connect(process.env.MONGO_URI);

const outs = await AlfaExcelOutboundUpdate.find({
  'changes.fechaInspeccion': { $exists: true },
  status: 'synced',
})
  .select('caseId consecutivo status excelRowNumber changes.fechaInspeccion match updatedAt')
  .sort({ updatedAt: -1 })
  .lean();

const byRow = {};
for (const o of outs) {
  const row = o.excelRowNumber ?? o.match?.excelRowNumber ?? '?';
  byRow[row] = byRow[row] || [];
  byRow[row].push({
    consecutivo: o.consecutivo,
    caseId: String(o.caseId),
    after: o.changes?.fechaInspeccion?.after ?? o.changes?.fechaInspeccion,
    updatedAt: o.updatedAt,
  });
}

const duplicateRows = Object.entries(byRow).filter(([, v]) => {
  const cases = new Set(v.map((x) => x.caseId));
  return cases.size > 1;
});

const uniqueCasesSynced = new Set(outs.map((o) => String(o.caseId)));

const daniela = await SegurosAlfaCaso.find({ identificacion: '1144041534' })
  .select('consecutivo fechaInspeccion direccionPredio')
  .lean();

const failed = await AlfaExcelOutboundUpdate.find({
  'changes.fechaInspeccion': { $exists: true },
  status: 'failed',
})
  .select('consecutivo lastError attempts excelRowNumber updatedAt')
  .lean();

// Casos con fecha cuyo último sync de fecha apunta a misma fila
const latestByCase = new Map();
for (const o of outs) {
  const id = String(o.caseId);
  const prev = latestByCase.get(id);
  if (!prev || new Date(o.updatedAt) > new Date(prev.updatedAt)) latestByCase.set(id, o);
}

const latestRows = [...latestByCase.values()].map((o) => ({
  consecutivo: o.consecutivo,
  row: o.excelRowNumber ?? o.match?.excelRowNumber ?? null,
  fecha: o.changes?.fechaInspeccion?.after ?? o.changes?.fechaInspeccion,
}));

const rowCountLatest = new Set(latestRows.map((r) => r.row).filter(Boolean)).size;

console.log(
  JSON.stringify(
    {
      syncedOutboundDocs: outs.length,
      uniqueCasesSyncedFecha: uniqueCasesSynced.size,
      uniqueExcelRowsFromLatestPerCase: rowCountLatest,
      latestPerCase: latestRows.sort((a, b) => String(a.consecutivo).localeCompare(String(b.consecutivo))),
      duplicateExcelRowsDifferentCases: duplicateRows,
      failedFechaOutbound: failed,
      danielaCasos: daniela,
    },
    null,
    2
  )
);

await mongoose.disconnect();
