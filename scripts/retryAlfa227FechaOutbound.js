/**
 * Reintenta outbound fechaInspeccion para ALFA-227 (Daniela).
 * node scripts/retryAlfa227FechaOutbound.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { enqueueAlfaExcelOutboundFromCaseUpdate } from '../services/alfaExcelOutboundService.js';
import { runAlfaExcelOutboundWorkerCycle } from '../workers/alfaExcelOutboundWorker.js';
import { resetMicrosoftGraphClient } from '../services/microsoftGraphService.js';

resetMicrosoftGraphClient();
await mongoose.connect(process.env.MONGO_URI);

const caso = await SegurosAlfaCaso.findOne({ consecutivo: 'ALFA-2026-08-227' });
if (!caso) throw new Error('Caso no encontrado');

// Cancelar failed previo
await AlfaExcelOutboundUpdate.updateMany(
  { caseId: caso._id, status: 'failed' },
  { $set: { status: 'cancelled' } }
);

const before = caso.toObject();
before.fechaInspeccion = null;
await enqueueAlfaExcelOutboundFromCaseUpdate({
  beforeDoc: before,
  afterDoc: caso.toObject(),
});

const cycle = await runAlfaExcelOutboundWorkerCycle({ batchSize: 5 });
console.log(JSON.stringify({ consecutivo: caso.consecutivo, cycle }, null, 2));

const last = await AlfaExcelOutboundUpdate.find({ caseId: caso._id })
  .sort({ updatedAt: -1 })
  .limit(2)
  .lean();
console.log(
  JSON.stringify(
    last.map((o) => ({
      status: o.status,
      row: o.excelRowNumber,
      err: o.lastError,
      fecha: o.changes?.fechaInspeccion?.after,
    })),
    null,
    2
  )
);

await mongoose.disconnect();
