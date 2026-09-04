/**
 * Repara corrimiento Y–AC: limpia fechas/texto en columnas incorrectas y
 * reescribe amarillas ARNALD por ENCABEZADO (nunca por letra vieja).
 *
 * node scripts/repairAlfaExcelShiftedYellowByHeader.js
 * node scripts/repairAlfaExcelShiftedYellowByHeader.js --ids=1144062095,16626535
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { getOutboundWritableFields } from '../config/alfaExcelOwnershipMap.js';
import { ALFA_EXCEL_DATE_FIELDS, ALFA_EXCEL_MONEY_FIELDS } from '../config/alfaExcelColumnMap.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import {
  resetMicrosoftGraphClient,
  getAccessToken,
  downloadDriveItemBuffer,
  getItemMetadata,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';
import { selectAlfaExcelFromSharePointFolder } from '../services/alfaExcelSharePointImportService.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import { normalizeIdentification } from '../utils/alfaExcelNormalize.js';

const FIELDS = getOutboundWritableFields();

const FOCUS_FIELDS = [
  'reserva',
  'valorReclamado',
  'valorLiquidado',
  'liquidadoCoberturaTerremo',
  'deducibleTerremoto',
  'valorLiquidacionCoberturasAdicionales',
  'deducibleCoberturasAdicionales',
  'valorTotalPagar',
  'fechaInspeccion',
  'fechaUltimoDocumento',
  'fechaLiquidado',
  'fechaAceptacionLiquidacion',
  'fechaEnvioAseguradora',
  'estadoGestion',
  'estado',
  'observacionesGestion',
  'valorReservaPreventivaPromedio',
  'valorComercialInmueble',
];

const CITED_IDS = [
  '1144062095',
  '1113639877',
  '31567340',
  '94392563',
  '1113621184',
  '16746059',
  '73120899',
  '66826399',
  '29177668',
  '1065609158',
  '1107078464',
  '31579744',
  '38655899',
  '38565636',
  '10523216',
  '1143829509',
  '66923335',
  '31284507',
  '1114059222',
  '16626535', // fila 651 JOSE WILLIAM ORTIZ GIRALDO
];

function argIds() {
  const raw = process.argv.find((a) => a.startsWith('--ids='));
  if (!raw) return null;
  return raw
    .slice(6)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function cellLooksLikeDate(v) {
  if (v == null || v === '') return false;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return true;
  const s = String(typeof v === 'object' && v.text != null ? v.text : v).trim();
  return (
    /^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/.test(s) ||
    /^\d{4}-\d{2}-\d{2}/.test(s)
  );
}

function cellLooksLikeNonDateText(v) {
  if (v == null || v === '') return false;
  if (v instanceof Date) return false;
  if (typeof v === 'number' && Number.isFinite(v)) return false;
  const s = String(typeof v === 'object' && v.text != null ? v.text : v).trim();
  if (!s) return false;
  if (cellLooksLikeDate(s)) return false;
  return (
    /inspeccionado|solicitud|contactado|cerrado|objetado|desistido|liquidado|sin contactar|document|evacuad|cotizaci|finiquito|sarlaft|visita|evidenc/i.test(
      s
    ) || s.length > 40
  );
}

function rowIsCorrupt(payload) {
  for (const f of ALFA_EXCEL_MONEY_FIELDS) {
    if (payload[f] != null && cellLooksLikeDate(payload[f])) return true;
    if (payload[f] != null && cellLooksLikeNonDateText(payload[f])) return true;
  }
  for (const f of ALFA_EXCEL_DATE_FIELDS) {
    if (payload[f] != null && cellLooksLikeNonDateText(payload[f])) return true;
  }
  return false;
}

await mongoose.connect(process.env.MONGO_URI);
resetMicrosoftGraphClient();
await getAccessToken();

const cfg = getAlfaExcelSharePointImportConfig();
const { driveId } = await resolveDriveContext();
const sel = await selectAlfaExcelFromSharePointFolder(cfg.rootPath, cfg.fileName);
const meta = await getItemMetadata(sel.selected.itemId);
const { buffer } = await downloadDriveItemBuffer({ driveId, itemId: meta.id });
const parsed = parseAlfaExcelBuffer(buffer);

const onlyIds = argIds();
const forceIds = new Set((onlyIds || CITED_IDS).map((id) => normalizeIdentification(id)));

const corruptIds = new Set();
for (const r of parsed.rows) {
  const p = r.payload || {};
  const id = normalizeIdentification(p.identificacion);
  if (!id) continue;
  if (forceIds.has(id) || rowIsCorrupt(p)) corruptIds.add(id);
}

console.log(
  JSON.stringify({
    event: 'CORRUPT_SCAN',
    file: sel.selected.name,
    rows: parsed.rows.length,
    corruptOrCited: corruptIds.size,
  })
);

const cancelled = await AlfaExcelOutboundUpdate.updateMany(
  { status: { $in: ['pending', 'processing', 'failed'] } },
  {
    $set: {
      status: 'cancelled',
      lastError: 'superseded_by_shifted_yellow_header_repair',
      lastErrorCode: 'SUPERSEDED',
      nextRetryAt: null,
    },
  }
);
console.log(JSON.stringify({ event: 'CANCELLED_OLD_QUEUE', n: cancelled.modifiedCount }));

const casos = await SegurosAlfaCaso.find({
  $or: [
    { identificacion: { $in: [...corruptIds] } },
    { identificacion: { $in: [...forceIds] } },
  ],
})
  .select(['_id', 'consecutivo', 'identificacion', ...FOCUS_FIELDS].join(' '))
  .lean();

// Match also by normalized id digits
const byNorm = new Map();
for (const c of casos) {
  byNorm.set(normalizeIdentification(c.identificacion), c);
}
const missing = [...corruptIds].filter((id) => !byNorm.has(id));
if (missing.length) {
  const extra = await SegurosAlfaCaso.find({})
    .select(['_id', 'consecutivo', 'identificacion', ...FOCUS_FIELDS].join(' '))
    .lean();
  for (const c of extra) {
    const n = normalizeIdentification(c.identificacion);
    if (corruptIds.has(n) && !byNorm.has(n)) byNorm.set(n, c);
  }
}

const targets = [...byNorm.values()];
console.log(JSON.stringify({ event: 'REPAIR_TARGETS', casos: targets.length, missingInArnald: missing.length }));

let enqueued = 0;
for (const caso of targets) {
  const dummyBefore = { _id: caso._id };
  const afterDoc = { _id: caso._id, consecutivo: caso.consecutivo };
  let has = false;
  for (const field of FOCUS_FIELDS) {
    if (!FIELDS.includes(field)) continue;
    const v = caso[field];
    // Forzar diff aunque el valor sea null: usamos sentinel en before
    // para campos con dato; si null, igual encolamos estado/obs si hay.
    if (v == null || v === '') continue;
    if (ALFA_EXCEL_DATE_FIELDS.includes(field)) {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) continue;
      dummyBefore[field] = new Date(d.getTime() + 86400000);
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      dummyBefore[field] = v + 1;
    } else {
      dummyBefore[field] = `__diff_${field}`;
    }
    afterDoc[field] = v;
    has = true;
  }
  // Disparar escritura (y sanitize de la fila) con el primer campo amarillo disponible.
  if (!has) {
    if (caso.estadoGestion) {
      dummyBefore.estadoGestion = `__x_${caso.estadoGestion}`;
      afterDoc.estadoGestion = caso.estadoGestion;
      has = true;
    } else if (caso.estado) {
      dummyBefore.estado = `__x_${caso.estado}`;
      afterDoc.estado = caso.estado;
      has = true;
    } else if (caso.observacionesGestion) {
      dummyBefore.observacionesGestion = `__x_${String(caso.observacionesGestion).slice(0, 20)}`;
      afterDoc.observacionesGestion = caso.observacionesGestion;
      has = true;
    }
  }
  if (!has) continue;
  const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: dummyBefore,
    afterDoc,
  });
  if (out) enqueued += 1;
}

await AlfaExcelOutboundUpdate.updateMany(
  { status: 'processing' },
  { $set: { status: 'pending', nextRetryAt: new Date(), attempts: 0 } }
);
await AlfaExcelOutboundUpdate.updateMany(
  { status: 'failed' },
  { $set: { status: 'pending', nextRetryAt: new Date(), attempts: 0, lastError: null, lastErrorCode: null } }
);

let rounds = 0;
let synced = 0;
let failedN = 0;
while (rounds < 400) {
  const pending = await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
  });
  if (pending === 0) break;
  rounds += 1;
  const summary = await runAlfaExcelOutboundCycle({ batchSize: 3 });
  for (const r of summary?.results || []) {
    if (r?.outcome === 'synced') synced += 1;
    if (r?.outcome === 'failed') failedN += 1;
  }
  const stillPending = await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
  });
  console.log(JSON.stringify({ round: rounds, pendingBefore: pending, stillPending, synced, failedN }));
}

console.log(
  JSON.stringify({
    done: true,
    enqueued,
    rounds,
    synced,
    failedN,
    note: 'rewrite_by_header_plus_sanitize',
  })
);

await mongoose.disconnect();
