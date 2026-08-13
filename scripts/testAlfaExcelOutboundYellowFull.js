/**
 * Prueba outbound amarillo completo R–AB vía cron automático.
 * NO llama worker manual.
 *
 * node scripts/testAlfaExcelOutboundYellowFull.js
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
import {
  getOutboundWritableFields,
  getOwnershipEntry,
} from '../config/alfaExcelOwnershipMap.js';
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
  throw new Error(`${label} TIMEOUT status=${last?.status}`);
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

async function applyAndEnqueue(caseId, patch) {
  const caso = await SegurosAlfaCaso.findById(caseId);
  const before = caso.toObject();
  Object.assign(caso, patch);
  await caso.save();
  const after = await SegurosAlfaCaso.findById(caseId);
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: before,
    afterDoc: after,
  });
  return { before, after, out, diff: buildOutboundCandidateChanges(before, after) };
}

async function main() {
  const writable = getOutboundWritableFields();
  console.log('writable', writable);
  assert(writable.length === 11, `expected 11 writable, got ${writable.length}`);
  assert(writable.includes('reserva') && writable.includes('estado'), 'R–AB incomplete');

  await mongoose.connect(process.env.MONGO_URI);
  const report = [];

  // —— 19. ajustador no mapeado ——
  {
    const r = await applyAndEnqueue(CASE_ID, { ajustador: `TEST-${Date.now()}` });
    assert(!r.out, 'ajustador NO debe crear outbox');
    assert(
      r.diff.rejected.some((x) => x.field === 'ajustador' && x.code === 'OUTBOUND_FIELD_NOT_MAPPED'),
      'ajustador NOT_MAPPED'
    );
    console.log('19 PASS: ajustador sin outbox');
  }

  // —— 20. verde correo ——
  {
    const r = await applyAndEnqueue(CASE_ID, {
      correo: `piloto+${Date.now()}@test.local`,
    });
    assert(!r.out, 'correo verde NO outbox');
    assert(
      r.diff.rejected.some(
        (x) => x.field === 'correo' && x.code === 'ALFA_EXCEL_FIELD_NOT_WRITABLE'
      ),
      'correo NOT_WRITABLE'
    );
    console.log('20 PASS: correo verde sin outbox');
  }

  // Snapshot verde B antes del multicampo (para comparar después)
  const caso0 = await SegurosAlfaCaso.findById(CASE_ID).lean();
  const source0 = await AlfaExcelSharePointSource.findOne({
    integrationKey: 'alfa-excel-control-seguimiento',
  }).lean();

  // —— A monto reserva ——
  {
    const r = await applyAndEnqueue(CASE_ID, { reserva: 12500000 });
    assert(r.out?.status === 'pending', 'A pending');
    assert(Object.keys(r.diff.writable).join() === 'reserva', 'A solo reserva');
    const synced = await waitSynced(r.out._id, 'A-RESERVA');
    const row = synced.doc.match.excelRowNumber;
    const cell = await readCell(
      synced.doc.sourceExcel.driveId,
      synced.doc.sourceExcel.itemId,
      'T',
      row
    );
    assert(typeof cell.value === 'number' && Math.abs(cell.value - 12500000) < 0.01, 'T numeric');
    const greenB = await readCell(
      synced.doc.sourceExcel.driveId,
      synced.doc.sourceExcel.itemId,
      'B',
      row
    );
    assert(String(greenB.value || greenB.text).includes(String(caso0.identificacion)), 'B intacto');
    report.push({
      field: 'reserva',
      column: 'T',
      row,
      before: r.diff.writable.reserva.before,
      after: r.diff.writable.reserva.after,
      cell: `T${row}`,
      strategy: synced.doc.sourceExcel.writeStrategy,
      eTagBefore: synced.doc.sourceExcel.eTagBefore,
      eTagAfter: synced.doc.sourceExcel.eTagAfter,
      verified: cell,
      elapsedMs: synced.elapsedMs,
    });
    console.log('A PASS: reserva → T');
  }

  // —— B fecha ——
  {
    const fecha = new Date('2026-08-21T15:00:00.000Z');
    const r = await applyAndEnqueue(CASE_ID, { fechaInspeccion: fecha });
    assert(r.out?.status === 'pending', 'B pending');
    const synced = await waitSynced(r.out._id, 'B-FECHA');
    const row = synced.doc.match.excelRowNumber;
    const cell = await readCell(
      synced.doc.sourceExcel.driveId,
      synced.doc.sourceExcel.itemId,
      'W',
      row
    );
    assert(String(cell.text || '').includes('21') || typeof cell.value === 'number', 'W fecha');
    report.push({
      field: 'fechaInspeccion',
      column: 'W',
      row,
      before: r.diff.writable.fechaInspeccion.before,
      after: r.diff.writable.fechaInspeccion.after,
      cell: `W${row}`,
      strategy: synced.doc.sourceExcel.writeStrategy,
      eTagBefore: synced.doc.sourceExcel.eTagBefore,
      eTagAfter: synced.doc.sourceExcel.eTagAfter,
      verified: cell,
      elapsedMs: synced.elapsedMs,
    });
    console.log('B PASS: fechaInspeccion → W');
  }

  // —— C estado ——
  {
    const caso = await SegurosAlfaCaso.findById(CASE_ID);
    const prevEstado = caso.estado;
    const nextEstado = prevEstado === 'EN GESTION' ? 'PENDIENTE' : 'EN GESTION';
    const r = await applyAndEnqueue(CASE_ID, { estado: nextEstado });
    assert(r.out?.status === 'pending', 'C pending');
    const synced = await waitSynced(r.out._id, 'C-ESTADO');
    const row = synced.doc.match.excelRowNumber;
    const cell = await readCell(
      synced.doc.sourceExcel.driveId,
      synced.doc.sourceExcel.itemId,
      'AB',
      row
    );
    assert(
      String(cell.value || cell.text).trim() === nextEstado,
      `AB expected ${nextEstado} got ${JSON.stringify(cell)}`
    );
    report.push({
      field: 'estado',
      column: 'AB',
      row,
      before: prevEstado,
      after: nextEstado,
      cell: `AB${row}`,
      strategy: synced.doc.sourceExcel.writeStrategy,
      eTagBefore: synced.doc.sourceExcel.eTagBefore,
      eTagAfter: synced.doc.sourceExcel.eTagAfter,
      verified: cell,
      elapsedMs: synced.elapsedMs,
    });
    console.log('C PASS: estado → AB');
  }

  // —— D multicampo ——
  {
    const caso = await SegurosAlfaCaso.findById(CASE_ID);
    const nextEstado = caso.estado === 'EN GESTION' ? 'PENDIENTE' : 'EN GESTION';
    const r = await applyAndEnqueue(CASE_ID, {
      reserva: 13000000,
      valorLiquidado: 5000000,
      fechaInspeccion: new Date('2026-08-22T12:00:00.000Z'),
      estado: nextEstado,
    });
    assert(r.out?.status === 'pending', 'D pending');
    const keys = Object.keys(r.diff.writable).sort();
    assert(
      keys.includes('reserva') &&
        keys.includes('valorLiquidado') &&
        keys.includes('fechaInspeccion') &&
        keys.includes('estado') &&
        keys.length === 4,
      `D keys ${keys}`
    );
    const synced = await waitSynced(r.out._id, 'D-MULTI');
    const cols = [...(synced.doc.sourceExcel.columnsWritten || [])].sort();
    assert(cols.join(',') === 'AB,T,V,W', `D cols ${cols}`);
    const row = synced.doc.match.excelRowNumber;
    const t = await readCell(synced.doc.sourceExcel.driveId, synced.doc.sourceExcel.itemId, 'T', row);
    const v = await readCell(synced.doc.sourceExcel.driveId, synced.doc.sourceExcel.itemId, 'V', row);
    const w = await readCell(synced.doc.sourceExcel.driveId, synced.doc.sourceExcel.itemId, 'W', row);
    const ab = await readCell(
      synced.doc.sourceExcel.driveId,
      synced.doc.sourceExcel.itemId,
      'AB',
      row
    );
    assert(Math.abs(Number(t.value) - 13000000) < 0.01, 'D T');
    assert(Math.abs(Number(v.value) - 5000000) < 0.01, 'D V');
    assert(String(ab.value || ab.text).trim() === nextEstado, 'D AB');
    assert(typeof w.value === 'number' || String(w.text || '').includes('22'), 'D W');

    const detect = await runAlfaExcelSharePointDetectCycle({ force: false });
    assert(
      detect.outcome === 'SKIP_ARNALD_GENERATED_VERSION' ||
        detect.outcome === 'SKIP_ALREADY_PREVIEWED',
      `inbound ${detect.outcome}`
    );
    const src = await AlfaExcelSharePointSource.findOne({
      integrationKey: 'alfa-excel-control-seguimiento',
    }).lean();
    assert(src.lastArnaldWrittenEtag === synced.doc.sourceExcel.eTagAfter, 'etag anti-loop');

    report.push({
      field: 'multi',
      columns: ['T', 'V', 'W', 'AB'],
      row,
      changes: r.diff.writable,
      strategy: synced.doc.sourceExcel.writeStrategy,
      eTagBefore: synced.doc.sourceExcel.eTagBefore,
      eTagAfter: synced.doc.sourceExcel.eTagAfter,
      verified: { T: t, V: v, W: w, AB: ab },
      inbound: detect.outcome,
      elapsedMs: synced.elapsedMs,
    });
    console.log('D PASS: multicampo T/V/W/AB');
  }

  // —— 18 CLEAR monto + fecha ——
  {
    const r = await applyAndEnqueue(CASE_ID, {
      reserva: null,
      fechaInspeccion: null,
    });
    assert(r.out?.status === 'pending', 'CLEAR pending');
    const synced = await waitSynced(r.out._id, 'CLEAR');
    const row = synced.doc.match.excelRowNumber;
    const t = await readCell(synced.doc.sourceExcel.driveId, synced.doc.sourceExcel.itemId, 'T', row);
    const w = await readCell(synced.doc.sourceExcel.driveId, synced.doc.sourceExcel.itemId, 'W', row);
    assert((t.value == null || t.value === '') && (!t.text || !String(t.text).trim()), 'T clear');
    assert((w.value == null || w.value === '') && (!w.text || !String(w.text).trim()), 'W clear');
    report.push({
      field: 'clear',
      columns: ['T', 'W'],
      row,
      eTagBefore: synced.doc.sourceExcel.eTagBefore,
      eTagAfter: synced.doc.sourceExcel.eTagAfter,
      verified: { T: t, W: w },
      elapsedMs: synced.elapsedMs,
    });
    console.log('18 PASS: clear T y W');
  }

  console.log('\n=== OUTBOUND AMARILLO COMPLETO: PASSED ===');
  console.log(JSON.stringify({ writable, report }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('YELLOW FULL FAILED', e.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
