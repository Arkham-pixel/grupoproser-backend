import '../config/loadEnv.js';
import dns from 'dns';
if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { estadoAlfaParaSharePoint } from '../config/alfaExcelStatuses.js';
import {
  parseAlfaExcelBuffer,
  matchAlfaCaseForExcelRow,
} from '../services/alfaExcelImportService.js';
import {
  downloadDriveItemBuffer,
  getItemMetadata,
} from '../services/microsoftGraphService.js';
import { findExcelRowForCase } from '../services/alfaExcelOutboundService.js';
import { enqueueAlfaExcelOutboundFromCaseUpdate } from '../services/alfaExcelOutboundService.js';

const APPLY = process.argv.includes('--apply');
const IDS = process.argv.includes('--only')
  ? [String(process.argv[process.argv.indexOf('--only') + 1] || '').trim()].filter(Boolean)
  : null;

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 25000,
});

const focusId = '1144084175';
const focus = await SegurosAlfaCaso.findOne({
  $or: [{ identificacion: focusId }, { consecutivo: 'ALFA-2026-08-223' }],
}).lean();

console.log(
  JSON.stringify(
    {
      event: 'FOCUS',
      caso: focus
        ? {
            _id: String(focus._id),
            consecutivo: focus.consecutivo,
            identificacion: focus.identificacion,
            asegurado: focus.asegurado,
            estado: focus.estado,
            estadoGestion: focus.estadoGestion,
            observacionesGestion: focus.observacionesGestion,
            controlSeguimientoExcel: focus.controlSeguimientoExcel,
            sharePointEstado: estadoAlfaParaSharePoint(focus.estado),
          }
        : null,
    },
    null,
    2
  )
);

if (focus) {
  const outs = await AlfaExcelOutboundUpdate.find({
    $or: [{ caseId: focus._id }, { consecutivo: focus.consecutivo }],
  })
    .sort({ createdAt: -1 })
    .limit(8)
    .lean();
  console.log(
    JSON.stringify(
      {
        event: 'FOCUS_OUTBOX',
        items: outs.map((o) => ({
          status: o.status,
          attempts: o.attempts,
          lastError: o.lastError,
          lastErrorCode: o.lastErrorCode,
          changesKeys: Object.keys(o.changes || {}),
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        })),
      },
      null,
      2
    )
  );
}

const cerrados = await SegurosAlfaCaso.find({
  $and: [
    { $or: [{ excluidoBaseAlfa: { $exists: false } }, { excluidoBaseAlfa: false }] },
    {
      estado: {
        $in: ['CERRADO', 'OBJETADO', 'DESISTIDO', 'LIQUIDADO', 'ENVIADO ASEGURADORA'],
      },
    },
    ...(IDS?.length ? [{ identificacion: { $in: IDS } }] : []),
  ],
})
  .select(
    'consecutivo identificacion asegurado estado estadoGestion observacionesGestion controlSeguimientoExcel updatedAt'
  )
  .lean();

console.log(JSON.stringify({ event: 'CERRADOS_TOTAL', n: cerrados.length }, null, 2));

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
const meta = await getItemMetadata(src.itemId);
const dl = await downloadDriveItemBuffer({
  driveId: meta.parentReference?.driveId || src.driveId,
  itemId: src.itemId,
});
const parsed = parseAlfaExcelBuffer(dl.buffer || dl);
const rows = parsed.rows || [];

const gaps = [];
for (const caso of cerrados) {
  let hit = null;
  try {
    hit = findExcelRowForCase(caso, rows);
  } catch (e) {
    gaps.push({
      consecutivo: caso.consecutivo,
      identificacion: caso.identificacion,
      asegurado: caso.asegurado,
      estadoArnald: caso.estado,
      esperadoExcel: estadoAlfaParaSharePoint(caso.estado),
      issue: e.code || e.message,
      ctrl: caso.controlSeguimientoExcel?.status || null,
    });
    continue;
  }
  const excelEstado = String(hit.payload?.estado || '').trim();
  const esperado = estadoAlfaParaSharePoint(caso.estado);
  const excelNorm = excelEstado
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
  const espNorm = String(esperado || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
  if (excelNorm !== espNorm) {
    gaps.push({
      consecutivo: caso.consecutivo,
      identificacion: caso.identificacion,
      asegurado: caso.asegurado,
      estadoArnald: caso.estado,
      esperadoExcel: esperado,
      excelEstado: excelEstado || null,
      excelRow: hit.rowNumber,
      issue: 'ESTADO_DESFASADO',
      ctrl: caso.controlSeguimientoExcel?.status || null,
    });
  }
}

console.log(
  JSON.stringify(
    {
      event: 'GAPS',
      fileName: meta.name,
      excelRows: rows.length,
      gaps: gaps.length,
      byIssue: gaps.reduce((acc, g) => {
        acc[g.issue] = (acc[g.issue] || 0) + 1;
        return acc;
      }, {}),
      sample: gaps.slice(0, 40),
      focusGap: gaps.find(
        (g) => g.identificacion === focusId || g.consecutivo === 'ALFA-2026-08-223'
      ),
    },
    null,
    2
  )
);

if (!APPLY) {
  console.log(JSON.stringify({ event: 'DRY_RUN', hint: 'Use --apply para reencolar gaps' }));
  await mongoose.disconnect();
  process.exit(0);
}

// Reencolar solo estado/estadoGestion (y observación si aplica) para gaps con fila.
let enqueued = 0;
for (const g of gaps) {
  if (g.issue === 'EXCEL_ROW_NOT_FOUND') continue;
  const caso = await SegurosAlfaCaso.findOne({ consecutivo: g.consecutivo }).lean();
  if (!caso) continue;
  const before = {
    ...caso,
    estado: g.excelEstado || 'Sin contactar',
    estadoGestion:
      g.excelEstado && !['CERRADO', 'LIQUIDADO', 'ENVIADO ASEGURADORA', 'OBJETADO', 'DESISTIDO'].includes(
        String(caso.estado || '').toUpperCase()
      )
        ? caso.estadoGestion
        : 'Sin contactar',
  };
  const doc = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: before,
    afterDoc: caso,
  });
  if (doc) enqueued += 1;
}

// Reactivar failed por FIELD_NOT_WRITABLE (limpiando campos en process)
const revived = await AlfaExcelOutboundUpdate.updateMany(
  {
    status: 'failed',
    lastErrorCode: 'ALFA_EXCEL_FIELD_NOT_WRITABLE',
  },
  {
    $set: {
      status: 'pending',
      attempts: 0,
      nextRetryAt: new Date(),
      lastError: null,
      lastErrorCode: null,
    },
  }
);

console.log(
  JSON.stringify(
    {
      event: 'ENQUEUED',
      enqueued,
      revivedFailedWritable: revived.modifiedCount ?? revived.nModified,
      skippedMissingRows: gaps.filter((g) => g.issue === 'EXCEL_ROW_NOT_FOUND').map((g) => g.consecutivo),
    },
    null,
    2
  )
);
await mongoose.disconnect();
