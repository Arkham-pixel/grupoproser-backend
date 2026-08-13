/**
 * Prueba outbound automático (cron del backend).
 * NO llama al worker manualmente — espera el cron cada 2 minutos.
 *
 * node scripts/testAlfaExcelOutboundAutoCron.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { enqueueAlfaExcelOutboundFromCaseUpdate } from '../services/alfaExcelOutboundService.js';
import { getOutboundWritableFields } from '../config/alfaExcelOwnershipMap.js';
import {
  createWorkbookSession,
  closeWorkbookSession,
  readWorkbookRange,
} from '../services/microsoftGraphService.js';
import { runAlfaExcelSharePointDetectCycle } from '../services/alfaExcelSharePointImportService.js';

const CASE_ID = '6a7c96aa54984615b6dff25e';
const POLL_MS = 5000;
const MAX_WAIT_MS = 180_000; // 3 min (cron */2)

function assert(c, m) {
  if (!c) throw new Error(m);
}

async function waitForSynced(outboundId, label) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < MAX_WAIT_MS) {
    last = await AlfaExcelOutboundUpdate.findById(outboundId).lean();
    console.log(
      `[${label}] t=${Math.round((Date.now() - t0) / 1000)}s status=${last?.status} attempts=${last?.attempts} err=${last?.lastError || '-'}`
    );
    if (last?.status === 'synced') {
      return { doc: last, elapsedMs: Date.now() - t0 };
    }
    if (last?.status === 'failed') {
      throw new Error(`${label} FAILED: ${last.lastErrorCode} ${last.lastError}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`${label} TIMEOUT waiting cron. last=${last?.status}`);
}

async function readCellX(driveId, itemId, row) {
  const session = await createWorkbookSession({
    driveId,
    itemId,
    persistChanges: false,
  });
  const range = await readWorkbookRange({
    driveId,
    itemId,
    worksheetName: 'BD',
    address: `X${row}`,
    sessionId: session.id,
  });
  await closeWorkbookSession({ driveId, itemId, sessionId: session.id });
  return {
    value: range?.values?.[0]?.[0] ?? null,
    text: range?.text?.[0]?.[0] ?? null,
  };
}

async function main() {
  console.log('writable fields', getOutboundWritableFields());
  assert(
    getOutboundWritableFields().length === 1 &&
      getOutboundWritableFields()[0] === 'fechaUltimoDocumento',
    'solo X debe estar habilitado'
  );

  await mongoose.connect(process.env.MONGO_URI);
  const caso = await SegurosAlfaCaso.findById(CASE_ID);
  assert(caso, 'CASE_NOT_FOUND');

  // —— 6. SET ——
  const setDate = new Date('2026-08-20T15:00:00.000Z');
  const beforeSet = caso.toObject();
  caso.fechaUltimoDocumento = setDate;
  await caso.save();
  const afterSet = await SegurosAlfaCaso.findById(CASE_ID);
  const outSet = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: beforeSet,
    afterDoc: afterSet,
  });
  assert(outSet && outSet.status === 'pending', 'set: outbox pending');
  console.log('SET enqueued', String(outSet._id));

  const setResult = await waitForSynced(outSet._id, 'SET');
  const setDoc = setResult.doc;
  assert(setDoc.sourceExcel?.columnsWritten?.[0] === 'X', 'solo X');
  const cellSet = await readCellX(
    setDoc.sourceExcel.driveId,
    setDoc.sourceExcel.itemId,
    setDoc.match.excelRowNumber
  );
  console.log('SET cell', cellSet);
  assert(
    String(cellSet.text || '').includes('20') ||
      String(cellSet.text || '').includes('2026-08-20') ||
      (typeof cellSet.value === 'number' && cellSet.value > 0),
    `SET cell not updated: ${JSON.stringify(cellSet)}`
  );

  const src1 = await AlfaExcelSharePointSource.findOne({
    integrationKey: 'alfa-excel-control-seguimiento',
  }).lean();
  assert(
    src1.lastArnaldWrittenEtag === setDoc.sourceExcel.eTagAfter,
    'lastArnald after set'
  );
  const detect1 = await runAlfaExcelSharePointDetectCycle({ force: false });
  assert(
    detect1.outcome === 'SKIP_ARNALD_GENERATED_VERSION' ||
      detect1.outcome === 'SKIP_ALREADY_PREVIEWED',
    `inbound set ${detect1.outcome}`
  );

  // —— 7. CLEAR ——
  const caso2 = await SegurosAlfaCaso.findById(CASE_ID);
  const beforeClear = caso2.toObject();
  caso2.fechaUltimoDocumento = null; // explícito (como ""→null en controller)
  await caso2.save();
  const afterClear = await SegurosAlfaCaso.findById(CASE_ID);
  const outClear = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: beforeClear,
    afterDoc: afterClear,
  });
  assert(outClear && outClear.status === 'pending', 'clear: outbox pending');
  console.log('CLEAR enqueued', String(outClear._id));

  const clearResult = await waitForSynced(outClear._id, 'CLEAR');
  const clearDoc = clearResult.doc;
  const cellClear = await readCellX(
    clearDoc.sourceExcel.driveId,
    clearDoc.sourceExcel.itemId,
    clearDoc.match.excelRowNumber
  );
  console.log('CLEAR cell', cellClear);
  assert(
    (cellClear.value == null || cellClear.value === '') &&
      (cellClear.text == null || String(cellClear.text).trim() === ''),
    `CLEAR cell not empty: ${JSON.stringify(cellClear)}`
  );

  const src2 = await AlfaExcelSharePointSource.findOne({
    integrationKey: 'alfa-excel-control-seguimiento',
  }).lean();
  assert(
    src2.lastArnaldWrittenEtag === clearDoc.sourceExcel.eTagAfter,
    'lastArnald after clear'
  );
  const detect2 = await runAlfaExcelSharePointDetectCycle({ force: false });
  assert(
    detect2.outcome === 'SKIP_ARNALD_GENERATED_VERSION' ||
      detect2.outcome === 'SKIP_ALREADY_PREVIEWED',
    `inbound clear ${detect2.outcome}`
  );

  console.log('\n=== OUTBOUND AUTOMÁTICO COLUMNA X: PASSED ===');
  console.log(
    JSON.stringify(
      {
        cron: '*/2 * * * *',
        writableOnly: getOutboundWritableFields(),
        set: {
          syncElapsedMs: setResult.elapsedMs,
          outboxStatus: setDoc.status,
          cell: `X${setDoc.match.excelRowNumber}`,
          cellValue: cellSet,
          eTagBefore: setDoc.sourceExcel.eTagBefore,
          eTagAfter: setDoc.sourceExcel.eTagAfter,
          inbound: detect1.outcome,
        },
        clear: {
          syncElapsedMs: clearResult.elapsedMs,
          outboxStatus: clearDoc.status,
          cell: `X${clearDoc.match.excelRowNumber}`,
          cellValue: cellClear,
          eTagBefore: clearDoc.sourceExcel.eTagBefore,
          eTagAfter: clearDoc.sourceExcel.eTagAfter,
          inbound: detect2.outcome,
        },
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('AUTO CRON TEST FAILED', e.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
