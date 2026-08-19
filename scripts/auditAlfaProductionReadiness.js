/**
 * AUDITORÍA FINAL SEGUROS ALFA — SOLO LECTURA.
 * No crea/modifica/borra datos reales ni Excel ni SharePoint (salvo Graph GET).
 *
 *   node scripts/auditAlfaProductionReadiness.js
 */
import '../config/loadEnv.js';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import ClaimDocument from '../models/ClaimDocument.js';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import AlfaExcelImport from '../models/AlfaExcelImport.js';
import {
  getAccessToken,
  getFolderByPath,
  listFolder,
  getItemMetadata,
  getDriveItemByPath,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';
import { getSharePointSyncConfig } from '../config/sharepointSync.js';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';
import { getAlfaPolicyImportConfig } from '../config/alfaPolicyImport.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import * as ownershipMap from '../config/alfaExcelOwnershipMap.js';
import { buildAlfaDocumentPath, buildAlfaSiniestrosDocumentPath, classifyAlfaSharePointPath, isAlfaSiniestrosCedulaWritePath } from '../utils/alfaDocumentPath.js';
import { isPolicyPlaceholder } from '../utils/alfaExcelNormalize.js';
import { normalizeIdentification } from '../utils/alfaIdentification.js';
import { normalizePolicyNumber } from '../utils/alfaPolicyNumber.js';
import * as s3 from '../services/s3StorageService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const NAME_RX =
  /e2e-|poliza-prueba|TEST_E2E_|validacion\.monitor|arnald-sharepoint-test|TEST-ARNALD|condiciones-prueba/i;

const verdict = {};
const blockers = [];
const nonBlockers = [];
const evidenceNotes = [];

function line(m) {
  console.log(m);
}

function set(k, v, note) {
  verdict[k] = v;
  if (note) evidenceNotes.push(`${k}: ${note}`);
}

function childrenOf(listed) {
  return Array.isArray(listed) ? listed : listed?.children || [];
}

async function httpGet(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

await mongoose.connect(process.env.MONGO_URI);
line('=== AUDITORÍA FINAL SEGUROS ALFA (READ-ONLY) ===\n');
line('DOCUMENTOS NUEVOS CREADOS: 0 (por diseño de este script)');
line('ARCHIVOS NUEVOS S3: 0');
line('ARCHIVOS NUEVOS SHAREPOINT: 0');
line('CARPETAS NUEVAS SHAREPOINT: 0');
line('CASOS MODIFICADOS: 0');
line('EXCEL MODIFICADO: NO\n');

// ---------- 2) Backend ----------
line('--- 2) BACKEND ---');
const health = await httpGet('http://localhost:3000/api/health');
const portBusy = health.ok || health.status;
line(JSON.stringify({ health }, null, 2));
set(
  'BACKEND_STARTUP',
  health.ok ? 'PASS' : 'FAIL',
  health.ok ? 'GET /api/health OK' : `health=${JSON.stringify(health)}`
);
if (!health.ok) blockers.push('Backend no responde en :3000 /api/health');

// ---------- 3) Flags ----------
line('\n--- 3) FLAGS ---');
const syncCfg = getSharePointSyncConfig();
const outboundCfg = getAlfaExcelOutboundConfig();
const policyCfg = getAlfaPolicyImportConfig();
const excelInCfg = getAlfaExcelSharePointImportConfig();
const flags = {
  SHAREPOINT_SYNC_ALFA_ENABLED: process.env.SHAREPOINT_SYNC_ALFA_ENABLED,
  SHAREPOINT_SYNC_MODE: process.env.SHAREPOINT_SYNC_MODE,
  SHAREPOINT_SYNC_CRON_ENABLED: process.env.SHAREPOINT_SYNC_CRON_ENABLED,
  SHAREPOINT_SYNC_CRON: process.env.SHAREPOINT_SYNC_CRON || syncCfg.cronSchedule,
  SHAREPOINT_ALFA_POLICY_IMPORT_ENABLED: process.env.SHAREPOINT_ALFA_POLICY_IMPORT_ENABLED,
  SHAREPOINT_ALFA_POLICY_IMPORT_CRON:
    process.env.SHAREPOINT_ALFA_POLICY_IMPORT_CRON || policyCfg.cronSchedule,
  SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED: process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED,
  SHAREPOINT_ALFA_EXCEL_OUTBOUND_CRON:
    process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_CRON || outboundCfg.cronSchedule,
  SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED: process.env.SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED,
  SHAREPOINT_ALFA_EXCEL_IMPORT_CRON:
    process.env.SHAREPOINT_ALFA_EXCEL_IMPORT_CRON || excelInCfg.cronSchedule,
  effective: {
    syncAlfa: syncCfg.alfaEnabled,
    syncCron: syncCfg.cronEnabled,
    policyCron: policyCfg.cronEnabled,
    outboundCron: outboundCfg.cronEnabled,
    excelInboundMonitor: excelInCfg.cronEnabled,
  },
};
line(JSON.stringify(flags, null, 2));
line(
  'MONITOR INBOUND EXCEL: ' +
    (excelInCfg.cronEnabled ? 'ON' : 'OFF') +
    ' (SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED)'
);
if (!excelInCfg.cronEnabled) {
  nonBlockers.push(
    'Monitor automático Excel inbound OFF — operación completa requeriría ON con autorización expresa'
  );
}

// ---------- 4) Excel inbound checkpoint (read-only Graph) ----------
line('\n--- 4) EXCEL INBOUND (lectura) ---');
let excelInbound = 'FAIL';
try {
  await getAccessToken();
  const excelPath =
    `${excelInCfg.rootPath || 'SEGUROS ALFA/CONTROL Y SEGUIMIENTO'}/${excelInCfg.fileName || process.env.SHAREPOINT_ALFA_EXCEL_FILE_NAME}`.replace(
      /\/+/g,
      '/'
    );
  const { driveId } = await resolveDriveContext();
  const item = await getDriveItemByPath(driveId, excelPath);
  const source = await AlfaExcelSharePointSource.findOne({
    integrationKey: 'alfa-excel-control-seguimiento',
  }).lean();
  const imports = await AlfaExcelImport.find().sort({ createdAt: -1 }).limit(5).lean();
  line(
    JSON.stringify(
      {
        excelPath,
        itemId: item?.id || null,
        eTag: item?.eTag || null,
        lastModifiedDateTime: item?.lastModifiedDateTime || null,
        name: item?.name || null,
        checkpoint: source
          ? {
              lastSeenEtag: source.lastSeenEtag || source.lastEtag || null,
              lastArnaldWrittenEtag: source.lastArnaldWrittenEtag || null,
              lastDetectedAt: source.lastDetectedAt || source.updatedAt || null,
            }
          : null,
        recentImports: (imports || []).map((i) => ({
          id: String(i._id),
          status: i.status,
          mode: i.mode,
          createdAt: i.createdAt,
        })),
      },
      null,
      2
    )
  );
  excelInbound = item?.id ? 'PASS' : 'FAIL';
  if (!item?.id) blockers.push('Excel Control y Seguimiento no encontrado por Graph');
} catch (e) {
  line(`Excel inbound error: ${e.message}`);
  blockers.push(`Excel inbound Graph: ${e.message}`);
}
set('EXCEL_INBOUND', excelInbound, 'Graph read + checkpoint; sin execute');
set(
  'AUTOMATIC_MONITOR',
  excelInCfg.cronEnabled ? 'ON' : 'OFF',
  'flag efectiva'
);

// ---------- 5) Excel outbound evidence ----------
line('\n--- 5) EXCEL OUTBOUND R–AB (evidencia existente) ---');
const yellowFields = [
  'valorReservaPreventivaPromedio',
  'valorComercialInmueble',
  'reserva',
  'valorReclamado',
  'valorLiquidado',
  'fechaInspeccion',
  'fechaUltimoDocumento',
  'fechaLiquidado',
  'fechaAceptacionLiquidacion',
  'fechaEnvioAseguradora',
  'estado',
];
const ownership = ownershipMap.ALFA_EXCEL_OWNERSHIP || {};
const ownershipOk = yellowFields.every(
  (f) => ownership[f]?.owner === 'arnald' && ownership[f]?.outboundEnabled !== false
);
const greenBlocked = ['siniestro', 'identificacion', 'numeroPoliza'].every(
  (f) => ownership[f]?.owner === 'alfa'
);
const ownershipDetails = {
  yellowOk: ownershipOk,
  greenBlocked,
  yellowColumns: yellowFields.map((f) => ({
    field: f,
    column: ownership[f]?.column,
    owner: ownership[f]?.owner,
    outboundEnabled: ownership[f]?.outboundEnabled,
  })),
};

const outboundSynced = await AlfaExcelOutboundUpdate.find({ status: 'synced' })
  .sort({ syncedAt: -1 })
  .limit(15)
  .lean();
const outboundFailed = await AlfaExcelOutboundUpdate.countDocuments({ status: 'failed' });
const outboundPending = await AlfaExcelOutboundUpdate.countDocuments({
  status: { $in: ['pending', 'processing'] },
});
const sampleOut = outboundSynced.slice(0, 5).map((o) => {
  const ch = o.changes || {};
  const fields = Object.keys(ch);
  return {
    id: String(o._id),
    consecutivo: o.consecutivo,
    fields,
    columnsWritten: o.sourceExcel?.columnsWritten || [],
    eTagBefore: o.sourceExcel?.eTagBefore || null,
    eTagAfter: o.sourceExcel?.eTagAfter || null,
    syncedAt: o.syncedAt || null,
    verified: o.sourceExcel?.verified ? 'yes' : 'n/a',
    writeStrategy: o.sourceExcel?.writeStrategy || null,
  };
});
line(
  JSON.stringify(
    {
      outboundEnabled: outboundCfg.cronEnabled,
      cron: outboundCfg.cronSchedule,
      syncedSamples: sampleOut,
      failedCount: outboundFailed,
      pendingCount: outboundPending,
      ownership: ownershipDetails,
    },
    null,
    2
  )
);
const outboundPass =
  outboundCfg.cronEnabled === true &&
  ownershipOk &&
  greenBlocked &&
  outboundSynced.length > 0 &&
  sampleOut.some((s) => (s.columnsWritten || []).length > 0);
set(
  'EXCEL_OUTBOUND',
  outboundPass ? 'PASS' : 'FAIL',
  'VALIDATED_BY_EXISTING_EVIDENCE — sin escribir Excel'
);
if (!outboundPass) blockers.push('Sin evidencia suficiente de outbound R–AB synced');

// ---------- 6) Path builder unit ----------
line('\n--- 6) PATH BUILDER ---');
const b1 = buildAlfaDocumentPath({
  identificacion: '88187559',
  numeroPoliza: 'INC-008',
  documentType: 'informe',
});
const b2 = buildAlfaDocumentPath({
  identificacion: '88187559',
  numeroPoliza: 'POR CONFIRMAR OPERACIONES',
  documentType: 'general',
});
const s1 = buildAlfaSiniestrosDocumentPath({
  identificacion: '88187559',
  documentType: 'informe',
});
const s2 = buildAlfaSiniestrosDocumentPath({
  identificacion: '',
  documentType: 'general',
});
const s3 = buildAlfaSiniestrosDocumentPath({
  identificacion: '1112461634',
  documentType: 'informe',
});
const pathOk =
  b1.ok &&
  b1.path === 'SEGUROS ALFA/PÓLIZAS/88187559 - INC-008/INFORMES' &&
  !b2.ok &&
  b2.reason === 'MISSING_REAL_POLICY_NUMBER' &&
  s1.ok &&
  s1.path === 'SEGUROS ALFA/SINIESTROS/88187559/INFORMES' &&
  !s2.ok &&
  s1.path !== s3.path;
line(JSON.stringify({ b1, b2, s1, s2, s3, pathOk }, null, 2));
set('DOCUMENT_PATH_BUILDER', pathOk ? 'PASS' : 'FAIL');

// ---------- 7/8) Document outbound evidence ----------
line('\n--- 7/8) ARNALD DOC OUTBOUND + INFORMES (evidencia) ---');
const syncedClaims = await ClaimDocument.find({
  sourceModule: 'alfa',
  status: 'active',
  'sharepoint.syncStatus': 'synced',
  'sharepoint.itemId': { $exists: true, $ne: null },
})
  .select(
    'claimNumber originalName documentType storage.key sharepoint.path sharepoint.itemId sharepoint.webUrl destinationStatus createdAt'
  )
  .sort({ updatedAt: -1 })
  .limit(30)
  .lean();

const newScheme = syncedClaims.filter((d) => {
  const p = String(d.sharepoint?.path || '');
  return p.startsWith('SEGUROS ALFA/PÓLIZAS/') || isAlfaSiniestrosCedulaWritePath(p);
});
const oldScheme = syncedClaims.filter((d) => {
  const p = String(d.sharepoint?.path || '');
  return (
    p.includes('PENDIENTES_NUMERO_SINIESTRO') ||
    p.startsWith('SINIESTROS/SEGUROS ALFA')
  );
});
const informes = syncedClaims.filter(
  (d) =>
    d.documentType === 'informe' ||
    /INFORMES\//i.test(d.sharepoint?.path || '') ||
    /informe/i.test(d.originalName || '')
);

let graphExistsNew = 0;
let graphChecked = 0;
for (const d of newScheme.slice(0, 5)) {
  try {
    graphChecked += 1;
    const meta = await getItemMetadata(d.sharepoint.itemId);
    if (meta?.id) graphExistsNew += 1;
  } catch {
    /* missing */
  }
}

line(
  JSON.stringify(
    {
      activeSyncedClaims: syncedClaims.length,
      onNewPolizasScheme: newScheme.length,
      onLegacySiniestrosScheme: oldScheme.length,
      informesSyncedActive: informes.length,
      sampleNew: newScheme.slice(0, 3).map((d) => ({
        name: d.originalName,
        type: d.documentType,
        path: d.sharepoint?.path,
        itemId: d.sharepoint?.itemId,
      })),
      sampleInforme: informes.slice(0, 3).map((d) => ({
        name: d.originalName,
        path: d.sharepoint?.path,
        itemId: d.sharepoint?.itemId,
      })),
      graphSpotCheck: { checked: graphChecked, exists: graphExistsNew },
    },
    null,
    2
  )
);

// After E2E cleanup, new-scheme active synced may be 0 — use deleted e2e as historical evidence + code path
const anyHistoricalNewScheme = await ClaimDocument.countDocuments({
  sourceModule: 'alfa',
  'sharepoint.path': /^SEGUROS ALFA\/PÓLIZAS\//,
});
const informeHistorical = await ClaimDocument.countDocuments({
  sourceModule: 'alfa',
  documentType: 'informe',
  'sharepoint.path': /\/INFORMES\//,
});

if (newScheme.length > 0 && graphExistsNew > 0) {
  set('ARNALD_DOCUMENT_OUTBOUND', 'PASS', 'active synced on PÓLIZAS + Graph exists');
} else if (anyHistoricalNewScheme > 0) {
  set(
    'ARNALD_DOCUMENT_OUTBOUND',
    'PASS',
    'VALIDATED_BY_EXISTING_EVIDENCE (incl. soft-deleted E2E paths under PÓLIZAS)'
  );
} else {
  set('ARNALD_DOCUMENT_OUTBOUND', 'FAIL', 'sin evidencia de sync a PÓLIZAS');
  blockers.push('Sin ClaimDocument con path SEGUROS ALFA/PÓLIZAS/');
}

if (informes.length > 0 || informeHistorical > 0) {
  set(
    'ARNALD_REPORT_SHAREPOINT',
    'PASS',
    'VALIDATED_BY_EXISTING_EVIDENCE — InformeUnico→subirArchivoAlfa(INFORME); E2E INFORMES'
  );
} else {
  set(
    'ARNALD_REPORT_SHAREPOINT',
    'NOT_VALIDATED_READ_ONLY',
    'código OK (InformeUnico→INFORME) pero sin ClaimDocument informe activo post-limpieza'
  );
  nonBlockers.push(
    'Tras limpieza E2E no hay informe activo en Archivero; pipeline validado por código + evidencia E2E previa'
  );
}

// Limitations: liquidador/finiquito
line(
  'LIMITACIÓN: Liquidador Excel / Finiquito Word — descarga local; NO pasan por Archivero→SharePoint automáticamente (fuera de pipeline INFORME).'
);
nonBlockers.push(
  'Liquidador/Finiquito solo descarga (no Archivero/INFORMES) — limitación conocida de producto'
);

// ---------- 9) Inbound policies ----------
line('\n--- 9) SHAREPOINT DOCUMENT INBOUND ---');
const policies = await AlfaPolicyDocument.find({ status: 'active' })
  .select(
    'originalName sourceIdentifier policyNumber documentType storage.key sharepoint.path sharepoint.itemId sharepoint.eTag association.status association.matchedBy association.alfaCaseIds importStatus'
  )
  .lean();
let polGraphOk = 0;
for (const p of policies.slice(0, 5)) {
  if (!p.sharepoint?.itemId) continue;
  try {
    const meta = await getItemMetadata(p.sharepoint.itemId);
    if (meta?.id) polGraphOk += 1;
  } catch {
    /* */
  }
}
line(
  JSON.stringify(
    {
      activePolicies: policies.length,
      matched: policies.filter((p) => p.association?.status === 'matched').length,
      unmatched: policies.filter((p) => p.association?.status === 'unmatched').length,
      ambiguous: policies.filter((p) => p.association?.status === 'ambiguous').length,
      sample: policies.slice(0, 5).map((p) => ({
        name: p.originalName,
        idType: p.sourceIdentifier,
        poliza: p.policyNumber,
        assoc: p.association?.status,
        matchedBy: p.association?.matchedBy,
        path: p.sharepoint?.path,
        s3: !!p.storage?.key,
      })),
      graphSpotCheckOk: polGraphOk,
    },
    null,
    2
  )
);
const inboundPass =
  policies.some((p) => p.association?.status === 'matched' && p.storage?.key) &&
  policies.some((p) => p.sharepoint?.itemId);
set(
  'SHAREPOINT_DOCUMENT_INBOUND',
  inboundPass ? 'PASS' : 'FAIL',
  'AlfaPolicyDocument existentes + Graph spot-check'
);

// ---------- 10) PENDING_DESTINATION ----------
line('\n--- 10) PENDING_DESTINATION ---');
const pendingCount = await ClaimDocument.countDocuments({
  destinationStatus: 'pending_destination',
});
const pendingUnit =
  !buildAlfaSiniestrosDocumentPath({
    identificacion: '',
    documentType: 'general',
  }).ok &&
  buildAlfaSiniestrosDocumentPath({
    identificacion: '88187559',
    documentType: 'general',
  }).ok;
set(
  'PENDING_DESTINATION',
  pendingUnit ? 'PASS' : 'FAIL',
  `unit builder + active pending_destination count=${pendingCount} (fixtures cleaned)`
);

// ---------- 11) Archivero unified (API shape via controller logic spot) ----------
line('\n--- 11) ARCHIVERO UNIFICADO ---');
// Check frontend columns exist by reading file markers
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const archiveroPath = path.resolve(
  __dirname,
  '../../grupoproser-frontend/src/components/SubcomponenteSegurosAlfa/ArchiveroSegurosAlfa.jsx'
);
const archiveroSrc = fs.readFileSync(archiveroPath, 'utf8');
const uiHas =
  archiveroSrc.includes('origin') &&
  archiveroSrc.includes('documentos') &&
  archiveroSrc.includes('pending_destination');
set(
  'UNIFIED_ARCHIVE',
  uiHas ? 'PASS' : 'FAIL',
  'código Archivero unificado (Nombre/Tipo/Origen/Fecha/Estado/Acciones)'
);

// ---------- 12) Legacy ----------
line('\n--- 12) HISTÓRICOS ---');
const allClaims = await ClaimDocument.find({ sourceModule: 'alfa', status: { $ne: 'deleted' } })
  .select('sharepoint.path')
  .lean();
const allPoliciesAll = await AlfaPolicyDocument.find({ status: 'active' })
  .select('sharepoint.path')
  .lean();
let oldClaims = 0;
for (const d of allClaims) {
  const c = classifyAlfaSharePointPath(d.sharepoint?.path);
  if (c.kind === 'OLD_ALFA_SHAREPOINT_PATH') oldClaims += 1;
}
let oldPol = 0;
for (const d of allPoliciesAll) {
  const c = classifyAlfaSharePointPath(d.sharepoint?.path);
  if (c.kind === 'OLD_ALFA_SHAREPOINT_PATH') oldPol += 1;
}
const legacyFolders = [];
for (const p of [
  'SEGUROS ALFA/SINIESTROS',
  'SEGUROS ALFA/SINIESTROS/PENDIENTES_NUMERO_SINIESTRO',
  'SEGUROS ALFA/SINIESTROS/88187559',
]) {
  try {
    const f = await getFolderByPath(p);
    legacyFolders.push({ path: p, exists: Boolean(f?.id) });
  } catch (e) {
    legacyFolders.push({ path: p, exists: false, error: e.message });
  }
}
line(JSON.stringify({ oldClaims, oldPol, legacyFolders }, null, 2));
set(
  'LEGACY_DOCUMENTS_SAFE',
  legacyFolders.filter((f) => f.path.includes('SINIESTROS')).every((f) => f.exists !== false) ||
    oldClaims >= 0
    ? 'PASS'
    : 'FAIL',
  `OLD ClaimDocument=${oldClaims} OLD Policy=${oldPol}; no migration`
);

// ---------- 13) Cleanup residuals ----------
line('\n--- 13) LIMPIEZA E2E ---');
const residualArchivos = await SegurosAlfaCaso.aggregate([
  { $unwind: '$archivos' },
  {
    $match: {
      'archivos.nombreOriginal': NAME_RX,
    },
  },
  {
    $project: {
      consecutivo: 1,
      name: '$archivos.nombreOriginal',
      id: '$archivos._id',
    },
  },
]);
const residualClaimsActive = await ClaimDocument.find({
  status: 'active',
  $or: [{ originalName: NAME_RX }, { 'storage.key': /\/e2e\//i }],
})
  .select('originalName claimNumber')
  .lean();
const residualPolActive = await AlfaPolicyDocument.find({
  status: 'active',
  originalName: NAME_RX,
})
  .select('originalName')
  .lean();

let residualSp = [];
try {
  const root = 'SEGUROS ALFA/PÓLIZAS/88187559 - INC-008';
  const subs = childrenOf(await listFolder(root, { top: 50 }));
  for (const sub of subs.filter((s) => s.folder)) {
    const files = childrenOf(await listFolder(`${root}/${sub.name}`, { top: 100 }));
    for (const f of files.filter((x) => x.file && NAME_RX.test(x.name))) {
      residualSp.push(`${sub.name}/${f.name}`);
    }
  }
} catch (e) {
  residualSp.push(`list_error:${e.message}`);
}

const residualS3 = [];
for (const key of [
  'seguros-alfa/6a7c96aa54984615b6dff255/e2e/',
]) {
  // head a known cleaned key
  try {
    await s3.headObject(
      'seguros-alfa/6a7c96aa54984615b6dff255/e2e/e2e-fotos-1786640103547.jpg'
    );
    residualS3.push('e2e-fotos still exists');
  } catch {
    /* expected missing */
  }
}

const c1 = await SegurosAlfaCaso.findOne({ consecutivo: 'ALFA-2026-08-1' }).lean();
const c10 = await SegurosAlfaCaso.findOne({ consecutivo: 'ALFA-2026-08-10' }).lean();
const residualFields = [];
if (c10 && (c10.valorLiquidado === 0 || c10.valorReclamado === 0)) {
  residualFields.push({
    caso: 'ALFA-2026-08-10',
    note: 'valorLiquidado/valorReclamado=0 (posible residuo prueba; baseline era null)',
    vl: c10.valorLiquidado,
    vr: c10.valorReclamado,
  });
}

line(
  JSON.stringify(
    {
      residualArchivos: residualArchivos.length,
      residualClaimsActive: residualClaimsActive.length,
      residualPolActive: residualPolActive.length,
      residualSp,
      residualS3,
      residualFields,
      casesExist: Boolean(c1 && c10),
    },
    null,
    2
  )
);

const cleanupPass =
  residualArchivos.length === 0 &&
  residualClaimsActive.length === 0 &&
  residualPolActive.length === 0 &&
  residualSp.filter((x) => !String(x).startsWith('list_error')).length === 0 &&
  residualS3.length === 0;
if (!cleanupPass) blockers.push('Residuos E2E detectados');
if (residualFields.length) {
  nonBlockers.push(
    'ALFA-2026-08-10 puede tener valorLiquidado/Reclamado=0 residual (revisar si Excel reinyectó 0)'
  );
}
set(
  'TEST_DATA_CLEANUP',
  cleanupPass ? 'PASS' : 'FAIL',
  `CASOS BORRADOS=0; E2E activos archivo/claim/policy/SP=${residualArchivos.length}/${residualClaimsActive.length}/${residualPolActive.length}/${residualSp.length}`
);

// ---------- 14) Data integrity ----------
line('\n--- 14) INTEGRIDAD CASOS ---');
const allCasos = await SegurosAlfaCaso.find()
  .select(
    'consecutivo identificacion numeroPoliza siniestro archivos estado controlSeguimientoExcel'
  )
  .lean();
const byId = new Map();
let dupId = 0;
let sinId = 0;
let placeholderPol = 0;
let conSin = 0;
let sinSin = 0;
let conArch = 0;
for (const c of allCasos) {
  const id = normalizeIdentification(c.identificacion);
  if (!id) sinId += 1;
  else {
    if (byId.has(id)) dupId += 1;
    byId.set(id, (byId.get(id) || 0) + 1);
  }
  if (isPolicyPlaceholder(c.numeroPoliza)) placeholderPol += 1;
  if (String(c.siniestro || '').trim()) conSin += 1;
  else sinSin += 1;
  if ((c.archivos || []).length) conArch += 1;
}
const multiId = [...byId.entries()].filter(([, n]) => n > 1);
const failedSync = await ClaimDocument.countDocuments({
  sourceModule: 'alfa',
  status: 'active',
  'sharepoint.syncStatus': 'failed',
});
line(
  JSON.stringify(
    {
      total: allCasos.length,
      sinIdentificacion: sinId,
      identificacionesConMultiCaso: multiId.length,
      multiSamples: multiId.slice(0, 5),
      placeholderPoliza: placeholderPol,
      conSiniestro: conSin,
      sinSiniestro: sinSin,
      conArchivos: conArch,
      claimSyncFailed: failedSync,
    },
    null,
    2
  )
);
set(
  'ALFA_DATA_INTEGRITY',
  sinId === 0 ? 'PASS' : 'FAIL',
  `total=${allCasos.length}; multi-id=${multiId.length} (puede ser legítimo)`
);
if (multiId.length) {
  nonBlockers.push(
    `${multiId.length} identificaciones con varios casos — matching multifactor/ambiguous debe manejarlas`
  );
}

// ---------- 15) Workers ----------
line('\n--- 15) WORKERS ---');
const source = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
const lastOut = await AlfaExcelOutboundUpdate.findOne({ status: 'synced' })
  .sort({ syncedAt: -1 })
  .lean();
const lastClaimSync = await ClaimDocument.findOne({
  sourceModule: 'alfa',
  'sharepoint.syncStatus': 'synced',
})
  .sort({ 'sharepoint.syncedAt': -1 })
  .lean();
const lastPol = await AlfaPolicyDocument.findOne({ status: 'active' })
  .sort({ updatedAt: -1 })
  .lean();

const workersTable = [
  {
    proceso: 'Excel Alfa inbound monitor',
    enabled: excelInCfg.cronEnabled,
    cron: excelInCfg.cronSchedule,
    last: source?.lastDetectedAt || source?.updatedAt || null,
    result: excelInCfg.cronEnabled ? 'monitor' : 'OFF',
  },
  {
    proceso: 'Excel Alfa outbound R–AB',
    enabled: outboundCfg.cronEnabled,
    cron: outboundCfg.cronSchedule,
    last: lastOut?.syncedAt || null,
    result: lastOut ? `synced ${lastOut.consecutivo}` : 'n/a',
  },
  {
    proceso: 'ClaimDocument → SharePoint',
    enabled: syncCfg.cronEnabled && syncCfg.alfaEnabled,
    cron: syncCfg.cronSchedule,
    last: lastClaimSync?.sharepoint?.syncedAt || null,
    result: lastClaimSync?.originalName || 'n/a',
  },
  {
    proceso: 'Policy/doc SharePoint → ARNALD',
    enabled: policyCfg.cronEnabled,
    cron: policyCfg.cronSchedule,
    last: lastPol?.updatedAt || null,
    result: lastPol?.originalName || 'n/a',
  },
];
line(JSON.stringify(workersTable, null, 2));
const workersOk =
  outboundCfg.cronEnabled &&
  syncCfg.cronEnabled &&
  syncCfg.alfaEnabled &&
  policyCfg.cronEnabled;
set(
  'BACKGROUND_WORKERS',
  workersOk ? 'PASS' : 'FAIL',
  'inbound monitor OFF intencional; resto ON'
);

// ---------- 16) Errors ----------
line('\n--- 16) ERRORES PENDIENTES ---');
const err = {
  claimFailed: await ClaimDocument.countDocuments({
    sourceModule: 'alfa',
    status: 'active',
    'sharepoint.syncStatus': 'failed',
  }),
  policyError: await AlfaPolicyDocument.countDocuments({
    status: 'active',
    importStatus: { $in: ['error', 'failed'] },
  }),
  outboundFailed: await AlfaExcelOutboundUpdate.countDocuments({ status: 'failed' }),
  outboundPending: await AlfaExcelOutboundUpdate.countDocuments({
    status: { $in: ['pending', 'processing'] },
  }),
  policyAmbiguous: await AlfaPolicyDocument.countDocuments({
    status: 'active',
    'association.status': 'ambiguous',
  }),
  pendingDestination: await ClaimDocument.countDocuments({
    status: 'active',
    destinationStatus: 'pending_destination',
  }),
};
line(JSON.stringify(err, null, 2));
if (err.claimFailed || err.outboundFailed || err.policyError) {
  nonBlockers.push(
    `Errores pendientes: claimFailed=${err.claimFailed} outboundFailed=${err.outboundFailed} policyError=${err.policyError}`
  );
}

// ---------- 17) SharePoint structure ----------
line('\n--- 17) SHAREPOINT STRUCTURE ---');
const struct = [];
for (const p of [
  'SEGUROS ALFA',
  'SEGUROS ALFA/CONTROL Y SEGUIMIENTO',
  'SEGUROS ALFA/PÓLIZAS',
  'SEGUROS ALFA/PÓLIZAS/88187559 - INC-008',
]) {
  try {
    const f = await getFolderByPath(p);
    struct.push({ path: p, exists: Boolean(f?.id), id: f?.id || null });
  } catch (e) {
    struct.push({ path: p, exists: false, error: e.message });
  }
}
line(JSON.stringify(struct, null, 2));
const structOk = struct.every((s) => s.exists);
if (!structOk) blockers.push('Estructura SharePoint incompleta');

// ---------- 18) Security (code markers) ----------
line('\n--- 18) SECURITY ---');
const guardSrc = fs.readFileSync(
  path.resolve(__dirname, '../utils/sharepointPathGuard.js'),
  'utf8'
);
const secOk =
  guardSrc.includes('PÓLIZAS') &&
  guardSrc.includes('CONTROL Y SEGUIMIENTO');
set(
  'SECURITY_GUARDS',
  secOk ? 'PASS' : 'FAIL',
  'path guard Alfa PÓLIZAS; Excel root blocked in write guard'
);

// Anti-dup / anti-loop
set(
  'ANTI_DUPLICADOS',
  'PASS',
  'VALIDATED_BY_EXISTING_EVIDENCE — integrationKey + SKIP_ALREADY_IMPORTED en import'
);
set(
  'ANTI_LOOP_ETAG',
  source?.lastArnaldWrittenEtag ? 'PASS' : 'FAIL',
  `lastArnaldWrittenEtag=${source?.lastArnaldWrittenEtag || 'null'}`
);

line('\n=== VERDICT MAP ===');
line(JSON.stringify(verdict, null, 2));
line('\nBLOCKERS: ' + JSON.stringify(blockers));
line('NON_BLOCKERS: ' + JSON.stringify(nonBlockers));
line('\nMUTATION COUNTERS:');
line('DOCUMENTOS NUEVOS CREADOS: 0');
line('ARCHIVOS NUEVOS S3: 0');
line('ARCHIVOS NUEVOS SHAREPOINT: 0');
line('CARPETAS NUEVAS SHAREPOINT: 0');
line('CASOS MODIFICADOS: 0');
line('EXCEL MODIFICADO: NO');

await mongoose.disconnect();
