/**
 * Diagnóstico rápido outbound — solo lectura (+ 1 ciclo worker SOLO si pending > 3 min).
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';
import { getOutboundWritableFields, getOwnershipEntry } from '../config/alfaExcelOwnershipMap.js';
import { isCronAlfaExcelOutboundActive } from '../services/cronAlfaExcelOutboundService.js';
import { runAlfaExcelOutboundWorkerCycle } from '../workers/alfaExcelOutboundWorker.js';
import {
  createWorkbookSession,
  closeWorkbookSession,
  readWorkbookRange,
} from '../services/microsoftGraphService.js';

function changesObj(c) {
  if (!c) return {};
  if (c instanceof Map) return Object.fromEntries(c.entries());
  if (typeof c.toObject === 'function') return c.toObject();
  return { ...c };
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

const cfg = getAlfaExcelOutboundConfig();
console.log('=== 1. CONFIG ===');
console.log(
  JSON.stringify(
    {
      processEnv: {
        SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED:
          process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED ?? null,
        SHAREPOINT_ALFA_EXCEL_OUTBOUND_CRON:
          process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_CRON ?? null,
      },
      getAlfaExcelOutboundConfig: {
        cronEnabled: cfg.cronEnabled,
        cronSchedule: cfg.cronSchedule,
        batchSize: cfg.batchSize,
        maxAttempts: cfg.maxAttempts,
      },
      writableFields: getOutboundWritableFields(),
      cronActiveInThisDiagnosticProcess: isCronAlfaExcelOutboundActive(),
      note: 'El cron vive en el proceso server.js; este script no lo registra.',
    },
    null,
    2
  )
);

console.log('\n=== 3. ÚLTIMOS OUTBOX (20) ===');
const recent = await AlfaExcelOutboundUpdate.find()
  .sort({ updatedAt: -1 })
  .limit(20)
  .lean();

const now = Date.now();
const summary = [];
for (const o of recent) {
  const changes = changesObj(o.changes);
  const ageMin = (now - new Date(o.createdAt).getTime()) / 60000;
  const pendingAgeMin =
    o.status === 'pending' ? (now - new Date(o.updatedAt || o.createdAt).getTime()) / 60000 : null;
  const row = {
    _id: String(o._id),
    caseId: String(o.caseId),
    consecutivo: o.consecutivo,
    status: o.status,
    changes,
    attempts: o.attempts,
    nextRetryAt: o.nextRetryAt,
    lastAttemptAt: o.lastAttemptAt,
    lastError: o.lastError,
    lastErrorCode: o.lastErrorCode,
    match: o.match,
    sourceExcel: o.sourceExcel
      ? {
          columnsWritten: o.sourceExcel.columnsWritten,
          eTagBefore: o.sourceExcel.eTagBefore,
          eTagAfter: o.sourceExcel.eTagAfter,
          writeStrategy: o.sourceExcel.writeStrategy,
        }
      : null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    ageMin: Number(ageMin.toFixed(1)),
    pendingAgeMin: pendingAgeMin != null ? Number(pendingAgeMin.toFixed(1)) : null,
  };
  summary.push(row);
  console.log(JSON.stringify(row, null, 2));
}

const byStatus = {};
for (const s of summary) {
  byStatus[s.status] = (byStatus[s.status] || 0) + 1;
}
console.log('\n=== 4. CLASIFICACIÓN ===', byStatus);

const stuckPending = summary.filter(
  (s) => s.status === 'pending' && s.pendingAgeMin != null && s.pendingAgeMin >= 3
);
const failed = summary.filter((s) => s.status === 'failed');
const latest = summary[0] || null;

let workerNote = null;
if (stuckPending.length > 0) {
  console.log('\n=== 5. PENDING > 3 min → ciclo worker manual ===');
  console.log(
    'stuck',
    stuckPending.map((s) => ({
      id: s._id,
      nextRetryAt: s.nextRetryAt,
      pendingAgeMin: s.pendingAgeMin,
    }))
  );
  // Forzar nextRetryAt solo en memoria del ciclo: el worker filtra nextRetryAt <= now.
  // Si nextRetryAt está en el futuro, eso explica por qué el cron no lo toma.
  for (const s of stuckPending) {
    if (s.nextRetryAt && new Date(s.nextRetryAt).getTime() > now) {
      console.log(
        'CAUSE_CANDIDATE: nextRetryAt en el futuro → cron/worker lo omiten hasta',
        s.nextRetryAt
      );
    }
  }
  workerNote = await runAlfaExcelOutboundWorkerCycle({ batchSize: 10 });
  console.log('workerResult', JSON.stringify(workerNote, null, 2));
  // refresh latest stuck
  for (const s of stuckPending) {
    const after = await AlfaExcelOutboundUpdate.findById(s._id).lean();
    console.log(
      'afterWorker',
      String(s._id),
      after?.status,
      after?.lastError,
      after?.sourceExcel
    );
  }
}

if (failed.length > 0) {
  console.log('\n=== 6. FAILED ===');
  for (const f of failed.slice(0, 5)) {
    console.log(
      JSON.stringify(
        {
          id: f._id,
          code: f.lastErrorCode,
          error: f.lastError,
          attempts: f.attempts,
          changes: f.changes,
        },
        null,
        2
      )
    );
  }
}

// 7. Si latest synced o after worker synced → verificar celdas
let verify = null;
const toVerify = await AlfaExcelOutboundUpdate.findOne({ status: 'synced' })
  .sort({ syncedAt: -1, updatedAt: -1 })
  .lean();
if (toVerify?.match?.excelRowNumber && toVerify.sourceExcel?.itemId) {
  console.log('\n=== 7. VERIFY último synced ===', String(toVerify._id));
  const changes = changesObj(toVerify.changes);
  const row = toVerify.match.excelRowNumber;
  const driveId = toVerify.sourceExcel.driveId;
  const itemId = toVerify.sourceExcel.itemId;
  const expected = {};
  const actual = {};
  for (const [field, diff] of Object.entries(changes)) {
    const col = diff.column || getOwnershipEntry(field)?.column;
    if (!col) continue;
    expected[`${col}`] = { field, after: diff.after };
    actual[`${col}`] = await readCell(driveId, itemId, col, row);
  }
  verify = {
    outboundId: String(toVerify._id),
    row,
    expected,
    actual,
    eTagBefore: toVerify.sourceExcel.eTagBefore,
    eTagAfter: toVerify.sourceExcel.eTagAfter,
  };
  console.log(JSON.stringify(verify, null, 2));
}

const source = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();

// Casos con controlSeguimientoExcel pending reciente
const pendingCases = await SegurosAlfaCaso.find({
  'controlSeguimientoExcel.status': { $in: ['pending', 'failed'] },
})
  .select('consecutivo controlSeguimientoExcel updatedAt')
  .sort({ updatedAt: -1 })
  .limit(10)
  .lean();
console.log('\nCasos controlSeguimientoExcel pending/failed:', pendingCases.length);
for (const c of pendingCases) {
  console.log(
    String(c._id),
    c.consecutivo,
    c.controlSeguimientoExcel?.status,
    c.controlSeguimientoExcel?.lastError
  );
}

console.log('\n=== 8. RESULTADO FINAL ===');
const focus =
  stuckPending[0] ||
  failed[0] ||
  summary.find((s) => s.status === 'pending') ||
  summary.find((s) => s.status === 'processing') ||
  latest;

const rootParts = [];
if (!cfg.cronEnabled) rootParts.push('OUTBOUND_ENABLED=false en process.env de este script/.env');
if (focus?.status === 'pending' && focus.nextRetryAt && new Date(focus.nextRetryAt) > new Date()) {
  rootParts.push(`nextRetryAt futuro (${focus.nextRetryAt}) — backoff tras error previo`);
}
if (focus?.status === 'pending' && (focus.pendingAgeMin || 0) >= 3) {
  rootParts.push('pending >3min: cron no procesó a tiempo o proceso server sin cron');
}
if (focus?.status === 'failed') {
  rootParts.push(`failed: ${focus.lastErrorCode || ''} ${focus.lastError || ''}`);
}
if (!recent.length) rootParts.push('No hay AlfaExcelOutboundUpdate — enqueue no corrió o campos no writable');
if (focus?.status === 'synced') rootParts.push('Último outbox synced — si Excel no refleja, ver verify celdas o caso distinto');

console.log(
  JSON.stringify(
    {
      CRON_CONFIG_ENABLED: cfg.cronEnabled,
      CRON_SCHEDULE: cfg.cronSchedule,
      HEALTH_BACKEND: 'ver logs server / puerto 3000',
      OUTBOX_CREADO: recent.length > 0,
      FOCUS_STATUS: focus?.status || null,
      FOCUS_ID: focus?._id || null,
      CAMBIOS: focus?.changes || null,
      ERROR: focus?.lastError || null,
      ERROR_CODE: focus?.lastErrorCode || null,
      NEXT_RETRY_AT: focus?.nextRetryAt || null,
      CELDAS_ESPERADAS: verify?.expected || null,
      CELDAS_REALES: verify?.actual || null,
      lastArnaldWrittenEtag: source?.lastArnaldWrittenEtag || null,
      eTagSource: source?.eTag || null,
      byStatus,
      ROOT_CAUSE_CANDIDATES: rootParts,
      workerNote,
    },
    null,
    2
  )
);

await mongoose.disconnect();
