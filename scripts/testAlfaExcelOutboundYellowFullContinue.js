/**
 * D multicampo (valores distintos) + CLEAR — espera cron.
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { enqueueAlfaExcelOutboundFromCaseUpdate } from '../services/alfaExcelOutboundService.js';
import {
  createWorkbookSession,
  closeWorkbookSession,
  readWorkbookRange,
} from '../services/microsoftGraphService.js';
import { runAlfaExcelSharePointDetectCycle } from '../services/alfaExcelSharePointImportService.js';

const CASE_ID = '6a7c96aa54984615b6dff25e';
const POLL_MS = 5000;
const MAX_WAIT_MS = 200_000;

function assert(c, m) {
  if (!c) throw new Error(m);
}

async function waitSynced(id, label) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < MAX_WAIT_MS) {
    last = await AlfaExcelOutboundUpdate.findById(id).lean();
    console.log(
      `[${label}] t=${Math.round((Date.now() - t0) / 1000)}s status=${last?.status} err=${last?.lastError || '-'}`
    );
    if (last?.status === 'synced') return { doc: last, elapsedMs: Date.now() - t0 };
    if (last?.status === 'failed') {
      throw new Error(`${label} FAILED ${last.lastErrorCode} ${last.lastError}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`${label} TIMEOUT`);
}

async function readCell(driveId, itemId, col, row) {
  const session = await createWorkbookSession({
    driveId,
    itemId,
    persistChanges: false,
  });
  const range = await readWorkbookRange({
    driveId,
    itemId,
    worksheetName: 'BD',
    address: `${col}${row}`,
    sessionId: session.id,
  });
  await closeWorkbookSession({ driveId, itemId, sessionId: session.id });
  return {
    value: range?.values?.[0]?.[0] ?? null,
    text: range?.text?.[0]?.[0] ?? null,
  };
}

await mongoose.connect(process.env.MONGO_URI);

// Drain any leftover pending
const leftover = await AlfaExcelOutboundUpdate.findOne({
  caseId: CASE_ID,
  status: { $in: ['pending', 'processing'] },
}).sort({ updatedAt: -1 });
if (leftover) {
  console.log('drain', String(leftover._id));
  await waitSynced(leftover._id, 'DRAIN');
}

const caso = await SegurosAlfaCaso.findById(CASE_ID);
const nextEstado = caso.estado === 'EN GESTION' ? 'PENDIENTE' : 'EN GESTION';
const before = caso.toObject();
// Valores distintos a los actuales para forzar 4 diffs
caso.reserva = 14500000;
caso.valorLiquidado = 6100000;
caso.fechaInspeccion = new Date('2026-08-25T12:00:00.000Z');
caso.estado = nextEstado;
await caso.save();
const after = await SegurosAlfaCaso.findById(CASE_ID);
const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
  beforeDoc: before,
  afterDoc: after,
});
assert(out?.status === 'pending', 'D pending');
const ch = out.changes instanceof Map ? Object.fromEntries(out.changes) : out.changes;
const keys = Object.keys(ch || {}).sort();
console.log('D keys', keys, ch);
assert(keys.length === 4, `expected 4 got ${keys}`);

const synced = await waitSynced(out._id, 'D-MULTI');
const cols = [...(synced.doc.sourceExcel.columnsWritten || [])].sort();
assert(cols.join(',') === 'AB,T,V,W', `cols ${cols}`);
const row = synced.doc.match.excelRowNumber;
const { driveId, itemId } = synced.doc.sourceExcel;
const t = await readCell(driveId, itemId, 'T', row);
const v = await readCell(driveId, itemId, 'V', row);
const w = await readCell(driveId, itemId, 'W', row);
const ab = await readCell(driveId, itemId, 'AB', row);
const b = await readCell(driveId, itemId, 'B', row);
assert(Math.abs(Number(t.value) - 14500000) < 0.01, `T=${t.value}`);
assert(Math.abs(Number(v.value) - 6100000) < 0.01, `V=${v.value}`);
assert(String(ab.value || ab.text).trim() === nextEstado, `AB=${ab.value}`);
assert(typeof w.value === 'number' || String(w.text || '').includes('25'), `W=${JSON.stringify(w)}`);
assert(String(b.value || b.text).includes('19247256'), 'green B intact');

const detect = await runAlfaExcelSharePointDetectCycle({ force: false });
assert(
  detect.outcome === 'SKIP_ARNALD_GENERATED_VERSION' ||
    detect.outcome === 'SKIP_ALREADY_PREVIEWED',
  detect.outcome
);

const dReport = {
  fields: keys,
  columns: cols,
  row,
  strategy: synced.doc.sourceExcel.writeStrategy,
  eTagBefore: synced.doc.sourceExcel.eTagBefore,
  eTagAfter: synced.doc.sourceExcel.eTagAfter,
  verified: { T: t, V: v, W: w, AB: ab, B: b },
  inbound: detect.outcome,
  elapsedMs: synced.elapsedMs,
};
console.log('D PASS', JSON.stringify(dReport, null, 2));

// CLEAR T + W
const caso2 = await SegurosAlfaCaso.findById(CASE_ID);
const before2 = caso2.toObject();
caso2.reserva = null;
caso2.fechaInspeccion = null;
await caso2.save();
const after2 = await SegurosAlfaCaso.findById(CASE_ID);
const out2 = await enqueueAlfaExcelOutboundFromCaseUpdate({
  beforeDoc: before2,
  afterDoc: after2,
});
assert(out2?.status === 'pending', 'CLEAR pending');
const clearSynced = await waitSynced(out2._id, 'CLEAR');
const row2 = clearSynced.doc.match.excelRowNumber;
const t2 = await readCell(
  clearSynced.doc.sourceExcel.driveId,
  clearSynced.doc.sourceExcel.itemId,
  'T',
  row2
);
const w2 = await readCell(
  clearSynced.doc.sourceExcel.driveId,
  clearSynced.doc.sourceExcel.itemId,
  'W',
  row2
);
assert((t2.value == null || t2.value === '') && (!t2.text || !String(t2.text).trim()), 'T clear');
assert((w2.value == null || w2.value === '') && (!w2.text || !String(w2.text).trim()), 'W clear');
const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
assert(src.lastArnaldWrittenEtag === clearSynced.doc.sourceExcel.eTagAfter, 'etag');

console.log('CLEAR PASS', {
  eTagBefore: clearSynced.doc.sourceExcel.eTagBefore,
  eTagAfter: clearSynced.doc.sourceExcel.eTagAfter,
  elapsedMs: clearSynced.elapsedMs,
  T: t2,
  W: w2,
});

console.log('\n=== OUTBOUND AMARILLO COMPLETO: PASSED ===');
await mongoose.disconnect();
