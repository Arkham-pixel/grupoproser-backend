/**
 * Diagnóstico outbound Alfa — solo lectura (+ 1 ciclo worker si hay pending).
 * NO limpia outbox. NO modifica Excel manualmente salvo worker sobre pending.
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';
import { getOwnershipEntry } from '../config/alfaExcelOwnershipMap.js';
import { isCronAlfaExcelOutboundActive } from '../services/cronAlfaExcelOutboundService.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import {
  resolveDriveContext,
  getItemMetadata,
  downloadDriveItemBuffer,
  graphRequest,
  createWorkbookSession,
  closeWorkbookSession,
} from '../services/microsoftGraphService.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import { findExcelRowForCase } from '../services/alfaExcelOutboundService.js';
import { runAlfaExcelOutboundWorkerCycle } from '../workers/alfaExcelOutboundWorker.js';
import ExcelJS from 'exceljs';

const CASE_HINT = process.argv[2] || null; // optional caseId

function section(title) {
  console.log(`\n========== ${title} ==========`);
}

async function main() {
  const cfg = getAlfaExcelOutboundConfig();
  section('1. CONFIG EFECTIVA');
  console.log(
    JSON.stringify(
      {
        processEnv: {
          SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED:
            process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED ?? null,
          SHAREPOINT_ALFA_EXCEL_OUTBOUND_CRON:
            process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_CRON ?? null,
          SHAREPOINT_ALFA_EXCEL_OUTBOUND_BATCH_SIZE:
            process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_BATCH_SIZE ?? null,
          SHAREPOINT_ALFA_EXCEL_OUTBOUND_MAX_ATTEMPTS:
            process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_MAX_ATTEMPTS ?? null,
        },
        getAlfaExcelOutboundConfig: cfg,
        // Este script NO arranca el cron del server.js; reportamos helper estático
        isCronAlfaExcelOutboundActive_inThisProcess: isCronAlfaExcelOutboundActive(),
        note: 'El cron solo se registra si el backend arrancó con enabled=true. Revisar logs del server en marcha.',
      },
      null,
      2
    )
  );

  section('OWNERSHIP fechaUltimoDocumento');
  console.log(JSON.stringify(getOwnershipEntry('fechaUltimoDocumento'), null, 2));

  await mongoose.connect(process.env.MONGO_URI);

  section('2. CASO');
  let caso = null;
  if (CASE_HINT) {
    caso = await SegurosAlfaCaso.findById(CASE_HINT).lean();
  }
  if (!caso) {
    // Más reciente con fechaUltimoDocumento o updatedAt reciente
    caso =
      (await SegurosAlfaCaso.findOne({ fechaUltimoDocumento: { $ne: null } })
        .sort({ updatedAt: -1 })
        .lean()) ||
      (await SegurosAlfaCaso.findOne().sort({ updatedAt: -1 }).lean());
  }
  if (!caso) {
    console.log('NO_CASE');
    await mongoose.disconnect();
    return;
  }
  console.log(
    JSON.stringify(
      {
        _id: String(caso._id),
        consecutivo: caso.consecutivo,
        identificacion: caso.identificacion,
        numeroPoliza: caso.numeroPoliza,
        numeroCredito: caso.numeroCredito,
        fechaUltimoDocumento: caso.fechaUltimoDocumento,
        updatedAt: caso.updatedAt,
        controlSeguimientoExcel: caso.controlSeguimientoExcel || null,
      },
      null,
      2
    )
  );

  section('3. OUTBOX por caseId');
  const outboxes = await AlfaExcelOutboundUpdate.find({ caseId: caso._id })
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean();
  console.log('count', outboxes.length);
  for (const o of outboxes) {
    const changes =
      o.changes instanceof Map
        ? Object.fromEntries(o.changes)
        : o.changes;
    console.log(
      JSON.stringify(
        {
          _id: String(o._id),
          status: o.status,
          changes,
          attempts: o.attempts,
          nextRetryAt: o.nextRetryAt,
          lastAttemptAt: o.lastAttemptAt,
          lastError: o.lastError,
          lastErrorCode: o.lastErrorCode,
          match: o.match,
          sourceExcel: o.sourceExcel,
          rejectedAtEnqueue: o.rejectedAtEnqueue,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        },
        null,
        2
      )
    );
  }

  const latest = outboxes[0] || null;
  let scenario = 'A_NO_OUTBOX';
  if (latest) {
    const map = {
      pending: 'B_PENDING',
      processing: 'C_PROCESSING',
      failed: 'D_FAILED',
      synced: 'E_SYNCED',
      cancelled: 'CANCELLED',
    };
    scenario = map[latest.status] || latest.status;
  }
  console.log('SCENARIO', scenario);

  section('CHECKPOINT SharePoint source');
  const source = await AlfaExcelSharePointSource.findOne({
    integrationKey: 'alfa-excel-control-seguimiento',
  }).lean();
  console.log(
    JSON.stringify(
      {
        itemId: source?.itemId,
        fileName: source?.fileName,
        eTag: source?.eTag,
        lastPreviewedEtag: source?.lastPreviewedEtag,
        lastArnaldWrittenEtag: source?.lastArnaldWrittenEtag,
        status: source?.status,
        lastOutcome: source?.lastOutcome,
      },
      null,
      2
    )
  );

  // 5. Si pending → un ciclo worker
  let workerResult = null;
  if (latest && (latest.status === 'pending' || latest.status === 'processing')) {
    section('5. WORKER CYCLE (manual, 1 vez)');
    // Si processing stale, no lo forzamos; solo pending con nextRetryAt pasado o forzamos nextRetryAt en memoria NO — user said no limpiar. For pending with future nextRetryAt, update only nextRetryAt to now would modify outbox. User said "No limpiar outbox" but running worker on pending is allowed. If nextRetryAt is in future, worker won't pick it — report that.
    const now = new Date();
    if (latest.status === 'pending' && latest.nextRetryAt && new Date(latest.nextRetryAt) > now) {
      console.log(
        'PENDING_BUT_NEXT_RETRY_IN_FUTURE',
        latest.nextRetryAt,
        '— worker no lo tomará hasta esa hora (no forzamos nextRetryAt para no alterar política).'
      );
    } else {
      workerResult = await runAlfaExcelOutboundWorkerCycle({ batchSize: 5 });
      console.log('workerResult', JSON.stringify(workerResult, null, 2));
      const after = await AlfaExcelOutboundUpdate.findById(latest._id).lean();
      console.log(
        'outboxAfterWorker',
        JSON.stringify(
          {
            status: after?.status,
            attempts: after?.attempts,
            lastError: after?.lastError,
            lastErrorCode: after?.lastErrorCode,
            match: after?.match,
            sourceExcel: after?.sourceExcel,
          },
          null,
          2
        )
      );
      latest.status = after?.status;
      Object.assign(latest, after || {});
    }
  }

  // 7. Verificar celda X en SharePoint (lectura)
  section('7. SHAREPOINT VERIFY celda X');
  let sharepointVerify = { expected: caso.fechaUltimoDocumento, actual: null, row: null, cell: null };
  try {
    const ctx = await resolveDriveContext();
    const driveId = source?.driveId || ctx.driveId;
    const itemId = source?.itemId;
    const meta = await getItemMetadata(itemId);
    console.log('live eTag', meta.eTag);

    const dl = await downloadDriveItemBuffer({ driveId, itemId });
    const parsed = parseAlfaExcelBuffer(dl.buffer);
    let hit = null;
    try {
      hit = findExcelRowForCase(caso, parsed.rows);
      console.log('MATCH', hit);
    } catch (e) {
      console.log('MATCH_FAIL', e.code || e.message);
    }

    if (hit) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(dl.buffer);
      const ws = wb.getWorksheet(parsed.sheetName);
      const cell = ws.getRow(hit.rowNumber).getCell(24); // X = 24
      const v = cell.value;
      const actual =
        v instanceof Date
          ? v.toISOString()
          : v && typeof v === 'object' && v.result != null
            ? String(v.result)
            : v == null
              ? null
              : String(v);
      sharepointVerify = {
        expected: caso.fechaUltimoDocumento
          ? new Date(caso.fechaUltimoDocumento).toISOString()
          : null,
        actual,
        row: hit.rowNumber,
        cell: `X${hit.rowNumber}`,
        sheet: parsed.sheetName,
        strategy: hit.strategy,
      };
      console.log('CELL_X', sharepointVerify);

      // También leer vía Graph range si posible
      try {
        const session = await createWorkbookSession({
          driveId,
          itemId,
          persistChanges: false,
        });
        const addr = `X${hit.rowNumber}`;
        const range = await graphRequest(
          `/drives/${driveId}/items/${itemId}/workbook/worksheets('BD')/range(address='${addr}')`,
          {
            method: 'GET',
            headers: { 'workbook-session-id': session.id },
          }
        );
        await closeWorkbookSession({ driveId, itemId, sessionId: session.id });
        console.log('GRAPH_RANGE_X', {
          address: range?.address,
          values: range?.values,
          text: range?.text,
        });
        if (range?.values?.[0]?.[0] != null && range.values[0][0] !== '') {
          sharepointVerify.actualGraph = String(range.values[0][0]);
        }
      } catch (ge) {
        console.log('GRAPH_RANGE_READ_FAIL', ge.status, ge.code, ge.message);
      }
    }
  } catch (e) {
    console.log('VERIFY_FAIL', e.message);
  }

  section('9. RESULTADO FINAL');
  const refreshed = latest
    ? await AlfaExcelOutboundUpdate.findById(latest._id).lean()
    : null;
  const final = {
    CONFIG_OUTBOUND: {
      enabled: cfg.cronEnabled,
      envRaw: process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED ?? null,
      cron: cfg.cronSchedule,
      cronActiveInThisDiagnosticProcess: isCronAlfaExcelOutboundActive(),
    },
    OUTBOX: {
      exists: Boolean(refreshed || latest),
      status: refreshed?.status || latest?.status || null,
      attempts: refreshed?.attempts ?? latest?.attempts ?? null,
      lastError: refreshed?.lastError || latest?.lastError || null,
      lastErrorCode: refreshed?.lastErrorCode || latest?.lastErrorCode || null,
      id: refreshed?._id ? String(refreshed._id) : latest?._id ? String(latest._id) : null,
    },
    MATCH: {
      row: refreshed?.match?.excelRowNumber || sharepointVerify.row || null,
      strategy: refreshed?.match?.strategy || sharepointVerify.strategy || null,
    },
    WRITE: {
      attempted: Boolean(workerResult),
      cell: sharepointVerify.cell,
      result: refreshed?.status || latest?.status || null,
      writeStrategy: refreshed?.sourceExcel?.writeStrategy || null,
      eTagBefore: refreshed?.sourceExcel?.eTagBefore || null,
      eTagAfter: refreshed?.sourceExcel?.eTagAfter || null,
    },
    SHAREPOINT_VERIFY: {
      expected: sharepointVerify.expected,
      actual: sharepointVerify.actual,
      actualGraph: sharepointVerify.actualGraph || null,
    },
    SCENARIO: scenario,
    lastArnaldWrittenEtag: source?.lastArnaldWrittenEtag || null,
  };
  console.log(JSON.stringify(final, null, 2));

  // Root cause hint (facts only)
  section('ROOT CAUSE CANDIDATES (facts)');
  if (!cfg.cronEnabled) {
    console.log(
      'FACT: SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED is false → cron NO procesa outbox automáticamente. Solo worker manual.'
    );
  }
  if (!latest) {
    console.log(
      'FACT: No hay AlfaExcelOutboundUpdate para este caseId → el save del caso NO encoló (diff no detectado, ownership, o enqueue falló).'
    );
  } else if (latest.status === 'pending' && latest.nextRetryAt && new Date(latest.nextRetryAt) > new Date()) {
    console.log('FACT: Outbox pending pero nextRetryAt en el futuro; cron off + retry no vencido.');
  } else if (latest.status === 'failed') {
    console.log('FACT: Outbox failed:', latest.lastErrorCode, latest.lastError);
  } else if (latest.status === 'synced') {
    const exp = sharepointVerify.expected
      ? new Date(sharepointVerify.expected).toISOString().slice(0, 10)
      : null;
    const act = (sharepointVerify.actualGraph || sharepointVerify.actual || '')
      .toString()
      .slice(0, 10);
    if (exp && act && !act.includes(exp.slice(0, 10)) && exp.slice(0, 10) !== act) {
      console.log(
        'FACT: status=synced pero celda X no coincide con Mongo expected.',
        { exp, act }
      );
    } else {
      console.log('FACT: status=synced y celda X parece alineada (o vacía/esperada según comparación).', {
        exp,
        act,
      });
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('DIAG_FATAL', e);
  process.exit(1);
});
