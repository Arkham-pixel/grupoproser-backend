/**
 * Fuerza Excel AI = PTE CONTACTO para casos migrados (y cancela outbounds que
 * aún quieren escribir EN GESTIÓN).
 *
 *   node scripts/forceAlfaPteContactoExcel.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { enqueueAlfaExcelOutboundFromCaseUpdate } from '../services/alfaExcelOutboundService.js';
import { runAlfaExcelOutboundWorkerCycle } from '../workers/alfaExcelOutboundWorker.js';

await mongoose.connect(process.env.MONGO_URI, {
  family: 4,
  serverSelectionTimeoutMS: 30000,
});

// 1) Cancelar outbounds que aún empujan EN GESTIÓN
const cancel = await AlfaExcelOutboundUpdate.updateMany(
  {
    status: { $in: ['pending', 'processing', 'failed'] },
    $or: [
      { 'changes.estadoGestion.after': 'EN GESTIÓN' },
      { 'changes.estadoGestion.after': 'EN GESTION' },
    ],
  },
  {
    $set: {
      status: 'cancelled',
      lastError: 'Cancelado: EN GESTIÓN ya no existe; usar PTE CONTACTO',
      lastErrorCode: 'EN_GESTION_DEPRECATED',
    },
  }
);
console.log('Cancelados EN GESTIÓN:', cancel.modifiedCount || cancel.nModified || 0);

// 2) Reencolar PTE CONTACTO desde Mongo (casos con PTE CONTACTO)
const casos = await SegurosAlfaCaso.find({ estadoGestion: 'PTE CONTACTO' })
  .select('_id consecutivo estado estadoGestion')
  .lean();
console.log('Casos PTE CONTACTO a reencolar:', casos.length);

let enqueued = 0;
for (const caso of casos) {
  await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: { ...caso, estadoGestion: 'EN GESTIÓN' },
    afterDoc: { ...caso, estadoGestion: 'PTE CONTACTO' },
  });
  enqueued += 1;
}
console.log('Encolados:', enqueued);

// 3) Liberar stuck processing
await AlfaExcelOutboundUpdate.updateMany(
  { status: 'processing' },
  { $set: { status: 'pending', nextRetryAt: new Date() } }
);

// 4) Procesar cola
for (let i = 1; i <= 40; i += 1) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({ status: 'pending' });
  if (!pending) {
    console.log(`Sin pendientes en ciclo ${i}`);
    break;
  }
  const summary = await runAlfaExcelOutboundWorkerCycle({ batchSize: 15 });
  console.log(
    `Ciclo ${i}: claimed=${summary.claimed} synced=${summary.synced} failed=${summary.failed} pendingRetry=${summary.pending}`
  );
  if (summary?.skippedOverlapping) await new Promise((r) => setTimeout(r, 4000));
}

const left = await AlfaExcelOutboundUpdate.countDocuments({
  status: { $in: ['pending', 'processing'] },
  'changes.estadoGestion': { $exists: true },
});
const failedEnGestion = await AlfaExcelOutboundUpdate.countDocuments({
  status: 'failed',
  'changes.estadoGestion.after': { $in: ['EN GESTIÓN', 'EN GESTION'] },
});
console.log(JSON.stringify({ leftGestionPending: left, failedEnGestion }, null, 2));
await mongoose.disconnect();
