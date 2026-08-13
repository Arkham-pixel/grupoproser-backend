/**
 * Valida borrado explícito fechaUltimoDocumento → limpia celda X.
 * Simula request con campo PRESENTE como "" (no ausente).
 *
 * node scripts/validateAlfaExcelOutboundClear.js [caseId]
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
import {
  createWorkbookSession,
  closeWorkbookSession,
  readWorkbookRange,
  getItemMetadata,
} from '../services/microsoftGraphService.js';

const CASE_ID = process.argv[2] || '6a7c96aa54984615b6dff25e';

/** Copia local de la regla del controller (campo presente vacío → null). */
function parseDateFlexible(value, fallback = null) {
  const esValorVacio = (v) =>
    v === undefined || v === null || v === '' || v === 'null' || v === 'undefined';
  if (value === undefined) return fallback ?? null;
  if (esValorVacio(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const caso = await SegurosAlfaCaso.findById(CASE_ID);
  assert(caso, 'CASE_NOT_FOUND');

  console.log('=== VALIDATE CLEAR fechaUltimoDocumento → X ===');
  console.log('case', String(caso._id), caso.consecutivo);

  // Asegurar valor previo en Mongo (si vacío, no se puede probar clear)
  if (!caso.fechaUltimoDocumento) {
    caso.fechaUltimoDocumento = new Date('2026-08-13T17:00:00.000Z');
    await caso.save();
    console.log('seeded fechaUltimoDocumento for clear test');
  }

  const beforeFecha = caso.fechaUltimoDocumento;
  console.log('before', beforeFecha?.toISOString?.() || beforeFecha);

  // Reglas ausente vs presente
  const absent = parseDateFlexible(undefined, beforeFecha);
  const presentEmpty = parseDateFlexible('', beforeFecha);
  const presentNull = parseDateFlexible(null, beforeFecha);
  assert(
    absent?.getTime?.() === new Date(beforeFecha).getTime(),
    'AUSENTE debe conservar fallback'
  );
  assert(presentEmpty === null, 'PRESENTE "" debe borrar → null');
  assert(presentNull === null, 'PRESENTE null debe borrar → null');
  console.log('parseDateFlexible: absent keeps / ""→null / null→null OK');

  const beforeDoc = caso.toObject();
  // Simular actualizarCasoAlfa con campo enviado ""
  caso.fechaUltimoDocumento = presentEmpty;
  await caso.save();
  const afterDoc = await SegurosAlfaCaso.findById(CASE_ID);
  assert(afterDoc.fechaUltimoDocumento == null, 'Mongo debe quedar null');

  const candidate = buildOutboundCandidateChanges(beforeDoc, afterDoc);
  console.log('diff writable', JSON.stringify(candidate.writable, null, 2));
  assert(candidate.writable.fechaUltimoDocumento, 'diff debe incluir fechaUltimoDocumento');
  assert(
    candidate.writable.fechaUltimoDocumento.after === null,
    'after debe ser null'
  );
  assert(
    candidate.writable.fechaUltimoDocumento.before != null,
    'before debe ser fecha anterior'
  );
  assert(candidate.writable.fechaUltimoDocumento.column === 'X', 'column X');

  const enqueued = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc,
    afterDoc,
  });
  assert(enqueued, 'debe crear outbox');
  assert(enqueued.status === 'pending', 'status pending');
  console.log('outbox', String(enqueued._id), enqueued.status);

  const sourceBefore = await AlfaExcelSharePointSource.findOne({
    integrationKey: 'alfa-excel-control-seguimiento',
  }).lean();
  const metaBefore = await getItemMetadata(sourceBefore.itemId);
  console.log('eTag before', metaBefore.eTag);

  const cycle = await runAlfaExcelOutboundWorkerCycle({ batchSize: 5 });
  console.log('worker', JSON.stringify(cycle));

  const synced = await AlfaExcelOutboundUpdate.findById(enqueued._id).lean();
  assert(synced.status === 'synced', `expected synced got ${synced.status} ${synced.lastError}`);
  assert(synced.match?.excelRowNumber > 1, 'fila');
  assert(
    synced.sourceExcel?.columnsWritten?.length === 1 &&
      synced.sourceExcel.columnsWritten[0] === 'X',
    'solo X'
  );
  console.log('match row', synced.match.excelRowNumber, synced.match.strategy);
  console.log('eTag', synced.sourceExcel.eTagBefore, '→', synced.sourceExcel.eTagAfter);
  console.log('verified', JSON.stringify(synced.sourceExcel.verified));

  // Lectura Graph independiente
  const session = await createWorkbookSession({
    driveId: synced.sourceExcel.driveId,
    itemId: synced.sourceExcel.itemId,
    persistChanges: false,
  });
  const addr = `X${synced.match.excelRowNumber}`;
  const range = await readWorkbookRange({
    driveId: synced.sourceExcel.driveId,
    itemId: synced.sourceExcel.itemId,
    worksheetName: 'BD',
    address: addr,
    sessionId: session.id,
  });
  await closeWorkbookSession({
    driveId: synced.sourceExcel.driveId,
    itemId: synced.sourceExcel.itemId,
    sessionId: session.id,
  });

  const actualValue = range?.values?.[0]?.[0];
  const actualText = range?.text?.[0]?.[0];
  console.log('SHAREPOINT cell', addr, { values: range?.values, text: range?.text });
  assert(
    (actualValue == null || actualValue === '') &&
      (actualText == null || String(actualText).trim() === ''),
    `celda X no vacía: value=${actualValue} text=${actualText}`
  );

  const sourceAfter = await AlfaExcelSharePointSource.findOne({
    integrationKey: 'alfa-excel-control-seguimiento',
  }).lean();
  assert(
    sourceAfter.lastArnaldWrittenEtag === synced.sourceExcel.eTagAfter,
    'lastArnaldWrittenEtag'
  );

  const detect = await runAlfaExcelSharePointDetectCycle({ force: false });
  assert(
    detect.outcome === 'SKIP_ARNALD_GENERATED_VERSION' ||
      detect.outcome === 'SKIP_ALREADY_PREVIEWED',
    `inbound ${detect.outcome}`
  );
  assert(detect.hasChanges !== true, 'no modal falso');

  console.log('\n=== RESULTADO ===');
  console.log(
    JSON.stringify(
      {
        before: beforeFecha,
        after: null,
        outbox: { id: String(synced._id), status: synced.status },
        cell: addr,
        eTagBefore: synced.sourceExcel.eTagBefore,
        eTagAfter: synced.sourceExcel.eTagAfter,
        sharePointFinal: { value: actualValue ?? null, text: actualText ?? null },
        lastArnaldWrittenEtag: sourceAfter.lastArnaldWrittenEtag,
        inbound: detect.outcome,
      },
      null,
      2
    )
  );
  console.log('CLEAR VALIDATION PASSED');
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('CLEAR VALIDATION FAILED', e.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
