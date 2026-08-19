/**
 * Los 5 casos con fechaInspeccion pero ESTADO vacío en Excel:
 * - en ARNALD siguen PENDIENTE
 * - outbound solo escribe campos que CAMBIAN → nunca mandó columna AB
 *
 * Este script: PENDIENTE → EN INSPECCIÓN + encola outbound de estado.
 * Uso: node scripts/syncAlfaEstadoForInspectedPending.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { resetMicrosoftGraphClient } from '../services/microsoftGraphService.js';

const TARGETS = [
  'ALFA-2026-08-4',
  'ALFA-2026-08-65',
  'ALFA-2026-08-74',
  'ALFA-2026-08-78',
  'ALFA-2026-08-227',
];

await mongoose.connect(process.env.MONGO_URI);
resetMicrosoftGraphClient();

for (const consecutivo of TARGETS) {
  const before = await SegurosAlfaCaso.findOne({ consecutivo });
  if (!before) {
    console.log('MISSING', consecutivo);
    continue;
  }
  if (!before.fechaInspeccion) {
    console.log('NO_FECHA', consecutivo, before.estado);
    continue;
  }
  if (String(before.estado || '').toUpperCase().includes('INSPECC')) {
    console.log('ALREADY', consecutivo, before.estado);
    const fakeBefore = before.toObject();
    fakeBefore.estado = 'PENDIENTE';
    await enqueueAlfaExcelOutboundFromCaseUpdate({
      beforeDoc: fakeBefore,
      afterDoc: before,
    });
    continue;
  }

  const after = await SegurosAlfaCaso.findByIdAndUpdate(
    before._id,
    { $set: { estado: 'EN INSPECCIÓN' } },
    { new: true }
  );
  const enq = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: before,
    afterDoc: after,
  });
  console.log('UPDATED', consecutivo, '→ EN INSPECCIÓN', 'outbox', enq?._id || enq);
}

const batch = await runAlfaExcelOutboundCycle({ batchSize: 10 });
console.log('BATCH', JSON.stringify(batch));
await mongoose.disconnect();
