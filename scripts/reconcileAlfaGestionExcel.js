/**
 * Reconcilia gaps estado/estadoGestion ARNALD vs Excel y procesa outbound.
 *   node scripts/reconcileAlfaGestionExcel.js
 *   node scripts/reconcileAlfaGestionExcel.js --dry-run
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { reconcileAlfaExcelEstadoGaps } from '../services/alfaExcelOutboundService.js';
import { runAlfaExcelOutboundWorkerCycle } from '../workers/alfaExcelOutboundWorker.js';

const dry = process.argv.includes('--dry-run');

await mongoose.connect(process.env.MONGO_URI, {
  family: 4,
  serverSelectionTimeoutMS: 45000,
});

const scan = await reconcileAlfaExcelEstadoGaps({ apply: !dry });
const gestionGaps = (scan.items || []).filter(
  (g) =>
    g.issue === 'ESTADO_GESTION_DESFASADO' ||
    g.issue === 'ESTADOS_DESFASADOS' ||
    /EN GESTI/i.test(String(g.excelGestion || ''))
);

console.log(
  JSON.stringify(
    {
      fileName: scan.fileName,
      gapsTotal: scan.gaps,
      enqueued: scan.enqueued,
      gestionGaps: gestionGaps.length,
      sampleGestion: gestionGaps.slice(0, 25).map((g) => ({
        c: g.consecutivo,
        arnald: g.estadoGestionArnald,
        excel: g.excelGestion,
        esperado: g.esperadoGestionExcel,
        row: g.excelRow,
        issue: g.issue,
      })),
    },
    null,
    2
  )
);

if (!dry) {
  await AlfaExcelOutboundUpdate.updateMany(
    { status: 'processing' },
    { $set: { status: 'pending', nextRetryAt: new Date() } }
  );
  for (let i = 1; i <= 50; i += 1) {
    const pending = await AlfaExcelOutboundUpdate.countDocuments({ status: 'pending' });
    if (!pending) {
      console.log(`Sin pendientes ciclo ${i}`);
      break;
    }
    const summary = await runAlfaExcelOutboundWorkerCycle({ batchSize: 15 });
    console.log(
      `Ciclo ${i}: claimed=${summary.claimed} synced=${summary.synced} failed=${summary.failed}`
    );
  }
}

await mongoose.disconnect();
