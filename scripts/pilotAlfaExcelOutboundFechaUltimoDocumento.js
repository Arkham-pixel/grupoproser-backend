/**
 * Piloto outbound: fechaUltimoDocumento → columna X.
 * NO activa cron. Procesa 1 ciclo manual del worker.
 *
 * Uso:
 *   node scripts/pilotAlfaExcelOutboundFechaUltimoDocumento.js
 *   node scripts/pilotAlfaExcelOutboundFechaUltimoDocumento.js --caseId=<mongoId>
 *   node scripts/pilotAlfaExcelOutboundFechaUltimoDocumento.js --dry-enqueue-only
 *
 * Restaura la fecha anterior en Mongo al final (Excel queda con el valor piloto
 * salvo --keep-excel). Para revertir Excel, volver a poner la fecha anterior
 * y correr el worker otra vez.
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  buildOutboundCandidateChanges,
} from '../services/alfaExcelOutboundService.js';
import { runAlfaExcelOutboundWorkerCycle } from '../workers/alfaExcelOutboundWorker.js';
import { runAlfaExcelSharePointDetectCycle } from '../services/alfaExcelSharePointImportService.js';
import { getOwnershipEntry } from '../config/alfaExcelOwnershipMap.js';

const args = process.argv.slice(2);
const dryEnqueueOnly = args.includes('--dry-enqueue-only');
const keepExcel = args.includes('--keep-excel');
const caseIdArg = args.find((a) => a.startsWith('--caseId='))?.split('=')[1];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function pickCase() {
  if (caseIdArg) {
    const c = await SegurosAlfaCaso.findById(caseIdArg);
    assert(c, `Caso no encontrado: ${caseIdArg}`);
    return c;
  }
  const c = await SegurosAlfaCaso.findOne({
    identificacion: { $exists: true, $ne: '' },
  }).sort({ updatedAt: -1 });
  assert(c, 'No hay casos Alfa en Mongo');
  return c;
}

async function main() {
  const uri = process.env.MONGO_URI;
  assert(uri, 'MONGO_URI requerido');
  await mongoose.connect(uri);

  const entry = getOwnershipEntry('fechaUltimoDocumento');
  assert(entry?.outboundEnabled === true, 'Piloto fechaUltimoDocumento no habilitado');
  assert(entry.column === 'X', 'Columna esperada X');

  console.log('=== PILOTO OUTBOUND fechaUltimoDocumento → X ===');
  console.log('cron outbound enabled env:', process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED || 'false');

  const caso = await pickCase();
  const beforeFecha = caso.fechaUltimoDocumento || null;
  // Fecha distinta a la actual para garantizar diff
  const base = beforeFecha ? new Date(beforeFecha).getTime() : Date.parse('2026-01-01');
  const pilotDate = new Date(base + 24 * 60 * 60 * 1000);
  // Evitar colisión con misma fecha ISO day
  if (beforeFecha && new Date(beforeFecha).toDateString() === pilotDate.toDateString()) {
    pilotDate.setUTCDate(pilotDate.getUTCDate() + 1);
  }

  console.log('caseId:', String(caso._id));
  console.log('consecutivo:', caso.consecutivo);
  console.log('identificacion:', caso.identificacion);
  console.log('numeroPoliza:', caso.numeroPoliza);
  console.log('fechaUltimoDocumento before:', beforeFecha);
  console.log('fechaUltimoDocumento pilot:', pilotDate.toISOString());

  // A) Campo Alfa no debe encolar
  const alfaProbe = buildOutboundCandidateChanges(caso, {
    ...caso.toObject(),
    identificacion: `${caso.identificacion}-NOPE`,
  });
  assert(
    Object.keys(alfaProbe.writable).length === 0,
    'A FAIL: cambio Alfa no debe ser writable'
  );
  console.log('A PASS: cambio identificación no genera writable');

  // B) Campo amarillo piloto sí
  const beforeDoc = caso.toObject();
  caso.fechaUltimoDocumento = pilotDate;
  await caso.save();
  const afterDoc = await SegurosAlfaCaso.findById(caso._id);

  const enqueued = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc,
    afterDoc,
  });
  assert(enqueued, 'B FAIL: no se creó outbox');
  assert(enqueued.status === 'pending', 'B FAIL: status != pending');
  const ch = enqueued.changes.get
    ? enqueued.changes.get('fechaUltimoDocumento')
    : enqueued.changes.fechaUltimoDocumento;
  assert(ch, 'B FAIL: falta change fechaUltimoDocumento');
  assert(ch.column === 'X', 'B FAIL: column != X');
  console.log('B PASS: outbox pending', String(enqueued._id));

  if (dryEnqueueOnly) {
    console.log('DRY: no se ejecuta worker. Restaurar Mongo…');
    await SegurosAlfaCaso.updateOne(
      { _id: caso._id },
      { $set: { fechaUltimoDocumento: beforeFecha } }
    );
    await AlfaExcelOutboundUpdate.updateOne(
      { _id: enqueued._id },
      { $set: { status: 'cancelled', lastError: 'dry-enqueue-only' } }
    );
    console.log('DONE dry');
    await mongoose.disconnect();
    return;
  }

  // C–J worker (reintentos cortos si Excel está bloqueado en SharePoint)
  let synced = null;
  for (let tryN = 1; tryN <= 6; tryN += 1) {
    // Forzar nextRetryAt inmediato en reintentos del piloto
    await AlfaExcelOutboundUpdate.updateOne(
      { _id: enqueued._id, status: 'pending' },
      { $set: { nextRetryAt: new Date() } }
    );
    const cycle = await runAlfaExcelOutboundWorkerCycle({ batchSize: 5 });
    console.log(`worker cycle #${tryN}:`, JSON.stringify(cycle));
    synced = await AlfaExcelOutboundUpdate.findById(enqueued._id);
    if (synced.status === 'synced') break;
    if (synced.status === 'failed') break;
    if (
      synced.lastErrorCode === 'EXCEL_SOURCE_LOCKED' ||
      /locked/i.test(synced.lastError || '')
    ) {
      console.log('Excel bloqueado en SharePoint; reintento en 20s…');
      await new Promise((r) => setTimeout(r, 20_000));
      continue;
    }
    break;
  }
  assert(synced.status === 'synced', `C FAIL: status=${synced.status} err=${synced.lastError}`);
  assert(synced.match?.excelRowNumber > 1, 'C FAIL: fila no encontrada');
  assert(
    Array.isArray(synced.sourceExcel?.columnsWritten) &&
      synced.sourceExcel.columnsWritten.length === 1 &&
      synced.sourceExcel.columnsWritten[0] === 'X',
    'E FAIL: columnsWritten != [X]'
  );
  assert(synced.sourceExcel?.eTagBefore, 'H FAIL: sin eTagBefore');
  assert(synced.sourceExcel?.eTagAfter, '8 FAIL: sin eTagAfter');
  assert(
    synced.sourceExcel.eTagBefore !== synced.sourceExcel.eTagAfter,
    '8 FAIL: eTag no cambió'
  );
  console.log('C–E PASS: synced row', synced.match.excelRowNumber, 'only X');
  console.log('eTag', synced.sourceExcel.eTagBefore, '→', synced.sourceExcel.eTagAfter);

  const source = await AlfaExcelSharePointSource.findOne({
    integrationKey: 'alfa-excel-control-seguimiento',
  }).lean();
  assert(source?.lastArnaldWrittenEtag === synced.sourceExcel.eTagAfter, '9 FAIL: lastArnaldWrittenEtag');
  console.log('9 PASS: lastArnaldWrittenEtag', source.lastArnaldWrittenEtag);

  // K — monitor inbound reconoce versión ARNALD
  const detect = await runAlfaExcelSharePointDetectCycle({ force: false });
  assert(
    detect.outcome === 'SKIP_ARNALD_GENERATED_VERSION' ||
      detect.outcome === 'SKIP_ALREADY_PREVIEWED',
    `K FAIL: outcome=${detect.outcome}`
  );
  assert(detect.hasChanges !== true, 'K FAIL: no debe reportar cambios externos');
  console.log('K PASS: inbound', detect.outcome);

  // Restaurar Mongo (y opcionalmente Excel vía nuevo outbox)
  if (!keepExcel) {
    const cur = await SegurosAlfaCaso.findById(caso._id);
    const mid = cur.toObject();
    cur.fechaUltimoDocumento = beforeFecha;
    await cur.save();
    const restored = await SegurosAlfaCaso.findById(caso._id);
    const restoreOut = await enqueueAlfaExcelOutboundFromCaseUpdate({
      beforeDoc: mid,
      afterDoc: restored,
    });
    if (restoreOut) {
      const restoreCycle = await runAlfaExcelOutboundWorkerCycle({ batchSize: 5 });
      console.log('restore excel cycle:', JSON.stringify(restoreCycle));
    } else {
      console.log('restore: sin outbox (fecha igual o null)');
    }
  }

  console.log('=== PILOTO PASSED ===');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('PILOTO FAILED', err.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
