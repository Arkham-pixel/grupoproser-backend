/**
 * E2E LIVE — Arquitectura documental final Alfa vs SharePoint real.
 * NO migra históricos.
 *
 * Por defecto NO usa casos reales.
 *   node scripts/e2eAlfaDocumentalLive.js --allow-real-case
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import ClaimDocument from '../models/ClaimDocument.js';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import * as s3 from '../services/s3StorageService.js';
import {
  getAccessToken,
  getFolderByPath,
  listFolder,
  uploadSmallFile,
  deleteItem,
} from '../services/microsoftGraphService.js';
import { enqueueAlfaClaimDocumentAfterUpload } from '../services/alfaClaimDocumentEnqueueService.js';
import { syncClaimDocument } from '../services/claimDocumentSyncService.js';
import { runAlfaPolicyImportCycle } from '../services/alfaPolicyImportService.js';
import { listImportedAlfaPoliciesForCase } from '../services/alfaPolicyImportService.js';
import { buildAlfaSharePointDocumentsStatus } from '../services/alfaSharePointStatusService.js';
import { getSharePointSyncConfig } from '../config/sharepointSync.js';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';
import { getAlfaPolicyImportConfig } from '../config/alfaPolicyImport.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import { buildAlfaDocumentPath } from '../utils/alfaDocumentPath.js';
import { sanitizeStoredFileName } from '../utils/sharepointClaimPath.js';
import {
  parseE2eArgs,
  assertAllowRealCaseOrExit,
  buildTestFileName,
} from './lib/alfaE2eGuard.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const { allowRealCase } = parseE2eArgs();
assertAllowRealCaseOrExit({
  allowRealCase,
  scriptName: 'e2eAlfaDocumentalLive.js',
});

const PILOT = {
  identificacion: '88187559',
  numeroPoliza: 'INC-008',
  consecutivo: 'ALFA-2026-08-1',
};
const ROOT = `SEGUROS ALFA/PÓLIZAS/${PILOT.identificacion} - ${PILOT.numeroPoliza}`;
const STAMP = Date.now();
const TEST_RUN_ID = `TEST_E2E_${STAMP}`;
const created = {
  claimIds: [],
  policyIds: [],
  s3Keys: [],
  spItemIds: [],
  caseSnapshot: null,
};

const results = [];
const checks = {
  archivero: 'FAIL',
  pendingDestination: 'FAIL',
  excelRegression: 'FAIL',
  historicos: 'FAIL',
};

function line(m) {
  console.log(m);
}

function mockReq({ s3Key, originalName, mimetype, size }) {
  return {
    file: { originalname: originalName, mimetype, size },
    fileStorage: {
      driver: 's3',
      s3Key,
      filename: sanitizeStoredFileName(originalName),
      publicPath: `s3:${s3Key}`,
      size,
      mimetype,
    },
    usuario: {
      id: new mongoose.Types.ObjectId().toString(),
      login: `e2e-doc-${TEST_RUN_ID}`,
      nombre: 'E2E Doc',
    },
  };
}

async function putS3(key, body, contentType) {
  await s3.putObject({ key, body, contentType });
  await s3.headObject(key);
  created.s3Keys.push(key);
  return key;
}

async function cleanupTestArtifacts(caso) {
  line(`\n--- CLEANUP finally ${TEST_RUN_ID} ---`);
  for (const itemId of [...new Set(created.spItemIds)]) {
    try {
      await deleteItem(itemId);
      line(`SP cleanup ${itemId}`);
    } catch (e) {
      line(`SP cleanup skip ${itemId}: ${e.message}`);
    }
  }
  for (const key of [...new Set(created.s3Keys)]) {
    try {
      await s3.deleteObject(key);
    } catch {
      /* ignore */
    }
  }
  if (created.claimIds.length) {
    await ClaimDocument.updateMany(
      { _id: { $in: created.claimIds } },
      {
        $set: {
          status: 'deleted',
          'sharepoint.enabled': false,
          'sharepoint.syncStatus': 'disabled',
        },
      }
    );
  }
  if (created.policyIds.length) {
    await AlfaPolicyDocument.updateMany(
      { _id: { $in: created.policyIds } },
      { $set: { status: 'deleted' } }
    );
  }
  await ClaimDocument.updateMany(
    { originalName: new RegExp(`TEST_E2E_${STAMP}`) },
    { $set: { status: 'deleted' } }
  );
  await AlfaPolicyDocument.updateMany(
    { originalName: new RegExp(`TEST_E2E_${STAMP}|poliza-prueba-e2e-${STAMP}`) },
    { $set: { status: 'deleted' } }
  );
  if (caso?._id && created.caseSnapshot) {
    const fresh = await SegurosAlfaCaso.findById(caso._id);
    if (fresh) {
      fresh.archivos = created.caseSnapshot.archivos;
      fresh.set('fechaUltimoDocumento', created.caseSnapshot.fechaUltimoDocumento);
      await fresh.save();
      line('Case snapshot restored (archivos + fechaUltimoDocumento)');
    }
  }
}

async function graphHasFile(folderPath, fileName) {
  const folder = await getFolderByPath(folderPath);
  if (!folder?.id) return { ok: false, reason: 'FOLDER_MISSING', folder: null, items: [] };
  const listed = await listFolder(folderPath, { top: 200 });
  const items = Array.isArray(listed) ? listed : listed?.children || [];
  const hit = items.find((it) => String(it.name) === fileName);
  return { ok: Boolean(hit), folder, items, hit };
}

async function uploadViaArchiveroFlow(caso, etiqueta, ext, mime, bodyBuf) {
  const fileName = buildTestFileName({ etiqueta, stamp: STAMP, ext });
  const s3Key = `seguros-alfa/${caso._id}/e2e/${fileName}`;
  await putS3(s3Key, bodyBuf, mime);

  const archivo = {
    nombreOriginal: fileName,
    nombreArchivo: sanitizeStoredFileName(fileName),
    ruta: `s3:${s3Key}`,
    tamaño: bodyBuf.length,
    tipoMime: mime,
    etiqueta,
    subidoPor: { login: `e2e-doc-${TEST_RUN_ID}`, nombre: 'E2E Doc' },
    fechaSubida: new Date(),
  };
  caso.archivos = caso.archivos || [];
  caso.archivos.push(archivo);
  caso.fechaUltimoDocumento = new Date();
  await caso.save();
  const creado = caso.archivos[caso.archivos.length - 1];

  const req = mockReq({
    s3Key,
    originalName: fileName,
    mimetype: mime,
    size: bodyBuf.length,
  });
  const enq = await enqueueAlfaClaimDocumentAfterUpload({
    caso,
    archivo: creado,
    req,
    etiqueta,
  });

  let syncResult = null;
  let doc = null;
  const docId = enq?.document?._id || enq?.documentId;
  if (docId) {
    created.claimIds.push(String(docId));
    // Si quedó pending destination no forzar sync a path inválido
    if (enq?.result === 'PENDING_DESTINATION') {
      doc = await ClaimDocument.findById(docId).lean();
    } else {
      syncResult = await syncClaimDocument(docId);
      doc = await ClaimDocument.findById(docId).lean();
    }
    if (doc?.sharepoint?.itemId) created.spItemIds.push(doc.sharepoint.itemId);
  }

  const expectedFolder = buildAlfaDocumentPath({
    identificacion: PILOT.identificacion,
    numeroPoliza: PILOT.numeroPoliza,
    documentType: etiqueta === 'FOTOS' ? 'fotografia' : etiqueta.toLowerCase() === 'informe' ? 'informe' : etiqueta.toLowerCase(),
  });
  // map etiqueta properly
  const typeMap = {
    FOTOS: 'fotografia',
    INSPECCION: 'inspeccion',
    LIQUIDACION: 'liquidacion',
    OTRO: 'otro',
    INFORME: 'informe',
    POLIZA: 'poliza',
    GENERAL: 'general',
  };
  const built = buildAlfaDocumentPath({
    identificacion: PILOT.identificacion,
    numeroPoliza: PILOT.numeroPoliza,
    documentType: typeMap[etiqueta] || 'otro',
  });

  const graph = await graphHasFile(built.path, fileName);

  return {
    etiqueta,
    fileName,
    s3Key,
    s3Ok: true,
    enq,
    syncResult,
    doc,
    expectedPath: `${built.path}/${fileName}`,
    graphOk: graph.ok,
    graphHit: graph.hit || null,
    folderOk: Boolean(graph.folder?.id),
  };
}

async function verifyHistoricosIntactos() {
  const probes = [
    'SINIESTROS/SEGUROS ALFA',
    'SEGUROS ALFA/SINIESTROS',
    'SEGUROS ALFA/SINIESTROS/PENDIENTES_NUMERO_SINIESTRO',
  ];
  const out = [];
  for (const p of probes) {
    try {
      const f = await getFolderByPath(p);
      out.push({ path: p, exists: Boolean(f?.id), id: f?.id || null });
    } catch (e) {
      out.push({ path: p, exists: false, error: e.message });
    }
  }
  // Also confirm pilot OLD policy path still present if any
  try {
    const old = await getFolderByPath('SEGUROS ALFA/SINIESTROS/88187559');
    out.push({
      path: 'SEGUROS ALFA/SINIESTROS/88187559',
      exists: Boolean(old?.id),
      id: old?.id || null,
    });
  } catch (e) {
    out.push({ path: 'SEGUROS ALFA/SINIESTROS/88187559', exists: false, error: e.message });
  }
  return out;
}

await mongoose.connect(process.env.MONGO_URI);

line('=== E2E DOCUMENTAL ALFA LIVE ===');
line(`testRunId=${TEST_RUN_ID} isTestData=true`);
line('');

let caso = null;
let e2ePass = false;
let flagsOk = false;

try {
// FLAGS block continues below — snapshot after caso load
const syncCfg = getSharePointSyncConfig();
const outboundCfg = getAlfaExcelOutboundConfig();
const policyCfg = getAlfaPolicyImportConfig();
const excelInCfg = getAlfaExcelSharePointImportConfig();
line('--- 1) FLAGS ---');
line(
  JSON.stringify(
    {
      SHAREPOINT_SYNC_ALFA_ENABLED: process.env.SHAREPOINT_SYNC_ALFA_ENABLED,
      SHAREPOINT_SYNC_MODE: process.env.SHAREPOINT_SYNC_MODE,
      SHAREPOINT_SYNC_CRON_ENABLED: process.env.SHAREPOINT_SYNC_CRON_ENABLED,
      SHAREPOINT_ALFA_POLICY_IMPORT_ENABLED: process.env.SHAREPOINT_ALFA_POLICY_IMPORT_ENABLED,
      SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED: process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED,
      SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED: process.env.SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED,
      syncCfg: {
        mode: syncCfg.mode,
        alfaEnabled: syncCfg.alfaEnabled,
        cronEnabled: syncCfg.cronEnabled,
      },
      outboundCron: outboundCfg.cronEnabled,
      policyCron: policyCfg.cronEnabled,
      excelInboundMonitor: excelInCfg.cronEnabled ?? excelInCfg.enabled ?? process.env.SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED,
    },
    null,
    2
  )
);

flagsOk =
  process.env.SHAREPOINT_SYNC_ALFA_ENABLED === 'true' &&
  process.env.SHAREPOINT_ALFA_POLICY_IMPORT_ENABLED === 'true' &&
  process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED === 'true' &&
  process.env.SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED !== 'true';
line(`FLAGS_OK: ${flagsOk}`);

await getAccessToken();
line('Graph token: OK');

caso = await SegurosAlfaCaso.findOne({
  consecutivo: PILOT.consecutivo,
  identificacion: PILOT.identificacion,
}).exec();
if (!caso) {
  throw new Error(`Caso piloto no encontrado: ${PILOT.consecutivo} / ${PILOT.identificacion}`);
}
created.caseSnapshot = {
  archivos: JSON.parse(JSON.stringify(caso.archivos || [])),
  fechaUltimoDocumento: caso.fechaUltimoDocumento || null,
};
line(
  `Caso: ${caso.consecutivo} id=${caso._id} poliza=${caso.numeroPoliza} siniestro=${caso.siniestro || '(vacío OK)'}`
);

const tinyJpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z',
  'base64'
);
const tinyTxt = (label) => Buffer.from(`E2E Alfa ${label} ${STAMP}\n`, 'utf8');
// Minimal ZIP/DOCX (PK header) — enough for SharePoint to store
const tinyDocx = Buffer.from(
  'PK\x03\x04\x14\x00\x00\x00\x08\x00E2E-INFORME-ALFA\nDocumento de prueba E2E INFORMES\n',
  'binary'
);
const tinyPdf = Buffer.from(
  `%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\nE2E POLIZA ${STAMP}\n`,
  'utf8'
);

// 2-5 outbound types
const uploadPlan = [
  { etiqueta: 'FOTOS', ext: 'jpg', mime: 'image/jpeg', body: tinyJpeg },
  { etiqueta: 'INSPECCION', ext: 'txt', mime: 'text/plain; charset=utf-8', body: tinyTxt('INSPECCION') },
  { etiqueta: 'LIQUIDACION', ext: 'txt', mime: 'text/plain; charset=utf-8', body: tinyTxt('LIQUIDACION') },
  { etiqueta: 'OTRO', ext: 'txt', mime: 'text/plain; charset=utf-8', body: tinyTxt('OTRO') },
  {
    etiqueta: 'INFORME',
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    body: tinyDocx,
  },
];

line('');
line('--- 2-6) UPLOADS ARNALD → S3 → ClaimDocument → SharePoint ---');
for (const step of uploadPlan) {
  try {
    const r = await uploadViaArchiveroFlow(caso, step.etiqueta, step.ext, step.mime, step.body);
    const status = r.doc?.sharepoint?.syncStatus || r.syncResult?.result || 'unknown';
    const pass =
      r.s3Ok &&
      status === 'synced' &&
      r.graphOk &&
      String(r.doc?.sharepoint?.path || '').includes(ROOT);
    results.push({
      tipo: step.etiqueta,
      archivo: r.fileName,
      s3: r.s3Key,
      claimOrPolicy: r.doc?._id ? String(r.doc._id) : null,
      rutaSp: r.doc?.sharepoint?.path || r.expectedPath,
      status,
      itemId: r.doc?.sharepoint?.itemId || null,
      webUrl: r.doc?.sharepoint?.webUrl || null,
      destinationStatus: r.doc?.destinationStatus || null,
      graphOk: r.graphOk,
      pass,
      enqResult: r.enq?.result,
    });
    line(
      `${step.etiqueta}: ${pass ? 'PASS' : 'FAIL'} status=${status} graph=${r.graphOk} path=${r.doc?.sharepoint?.path || r.expectedPath}`
    );
  } catch (err) {
    results.push({
      tipo: step.etiqueta,
      archivo: null,
      s3: null,
      claimOrPolicy: null,
      rutaSp: null,
      status: 'ERROR',
      itemId: null,
      pass: false,
      error: err.message,
    });
    line(`${step.etiqueta}: FAIL ${err.message}`);
  }
}

// 7) POLIZA inbound
line('');
line('--- 7) POLIZA INBOUND ---');
const polizaName = `poliza-prueba-e2e-${STAMP}.pdf`;
const polizaFolder = `${ROOT}/POLIZA`;
let polizaInbound = {
  tipo: 'POLIZA inbound',
  archivo: polizaName,
  pass: false,
};
try {
  const up = await uploadSmallFile(polizaFolder, polizaName, tinyPdf, {
    contentType: 'application/pdf',
  });
  if (up?.id) created.spItemIds.push(up.id);
  line(`Uploaded to SP: ${polizaFolder}/${polizaName} itemId=${up?.id}`);

  const summary1 = await runAlfaPolicyImportCycle({ batchSize: 50 });
  line(`Import cycle 1: ${JSON.stringify(summary1)}`);
  const summary2 = await runAlfaPolicyImportCycle({ batchSize: 50 });
  line(`Import cycle 2 (idempotency): ${JSON.stringify(summary2)}`);

  const polDoc = await AlfaPolicyDocument.findOne({
    'sharepoint.itemId': up.id,
  }).lean();
  if (polDoc?._id) created.policyIds.push(String(polDoc._id));
  if (polDoc?.storage?.key) created.s3Keys.push(polDoc.storage.key);
  const matched =
    polDoc &&
    String(polDoc.association?.status) === 'matched' &&
    (polDoc.association?.alfaCaseIds || []).some((id) => String(id) === String(caso._id));

  polizaInbound = {
    tipo: 'POLIZA inbound',
    archivo: polizaName,
    s3: polDoc?.storage?.key || null,
    claimOrPolicy: polDoc?._id ? String(polDoc._id) : null,
    rutaSp: polDoc?.sharepoint?.path || `${polizaFolder}/${polizaName}`,
    status: polDoc?.association?.status || 'missing',
    itemId: polDoc?.sharepoint?.itemId || up.id,
    webUrl: polDoc?.sharepoint?.webUrl || up.webUrl || null,
    pass: Boolean(matched && polDoc?.storage?.key),
    import1: summary1,
    import2: summary2,
  };
  results.push(polizaInbound);
  line(`POLIZA inbound: ${polizaInbound.pass ? 'PASS' : 'FAIL'}`);
} catch (err) {
  polizaInbound.error = err.message;
  results.push(polizaInbound);
  line(`POLIZA inbound: FAIL ${err.message}`);
}

// 8) Archivero unificado
line('');
line('--- 8) ARCHIVERO UNIFICADO ---');
try {
  const fresh = await SegurosAlfaCaso.findById(caso._id).lean();
  const polizasImportadas = await listImportedAlfaPoliciesForCase(fresh);
  const sp = await buildAlfaSharePointDocumentsStatus(fresh);
  const arnaldCount = (fresh.archivos || []).length;
  const inboundCount = (polizasImportadas || []).length;
  const hasInforme = (fresh.archivos || []).some(
    (a) => String(a.etiqueta || '').toUpperCase() === 'INFORME' && String(a.nombreOriginal || '').includes(String(STAMP))
  );
  const hasFotos = (fresh.archivos || []).some(
    (a) => String(a.etiqueta || '').toUpperCase() === 'FOTOS' && String(a.nombreOriginal || '').includes(String(STAMP))
  );
  const hasInboundPoliza = (polizasImportadas || []).some(
    (p) => String(p.originalName || '').includes(String(STAMP)) || String(p.originalName || '').includes('poliza-prueba')
  );
  const unifiedOk = arnaldCount > 0 && hasInforme && hasFotos && hasInboundPoliza && inboundCount > 0;
  checks.archivero = unifiedOk ? 'PASS' : 'FAIL';
  line(
    JSON.stringify(
      {
        arnaldCount,
        inboundCount,
        hasInforme,
        hasFotos,
        hasInboundPoliza,
        syncSummary: sp.summary || null,
        sampleInbound: (polizasImportadas || []).slice(0, 3).map((p) => ({
          name: p.originalName,
          origin: 'ALFA / SHAREPOINT',
          type: p.documentType,
        })),
      },
      null,
      2
    )
  );
  line(`ARCHIVERO UNIFICADO: ${checks.archivero}`);
} catch (err) {
  line(`ARCHIVERO UNIFICADO: FAIL ${err.message}`);
}

// 9) PENDING_DESTINATION fixture
line('');
line('--- 9) PENDING_DESTINATION FIXTURE ---');
let pendingCaso = null;
try {
  pendingCaso = await SegurosAlfaCaso.create({
    consecutivo: `E2E-PEND-${STAMP}`,
    identificacion: '99887766',
    numeroPoliza: 'POR CONFIRMAR OPERACIONES',
    tomador: 'E2E TEST',
    asegurado: 'E2E TEST',
    estado: 'PENDIENTE',
    archivos: [],
  });
  const fileName = `e2e-pending-${STAMP}.txt`;
  const s3Key = `seguros-alfa/${pendingCaso._id}/e2e/${fileName}`;
  const body = tinyTxt('PENDING');
  await putS3(s3Key, body, 'text/plain; charset=utf-8');
  const archivo = {
    nombreOriginal: fileName,
    nombreArchivo: sanitizeStoredFileName(fileName),
    ruta: `s3:${s3Key}`,
    tamaño: body.length,
    tipoMime: 'text/plain; charset=utf-8',
    etiqueta: 'GENERAL',
    fechaSubida: new Date(),
  };
  pendingCaso.archivos.push(archivo);
  await pendingCaso.save();
  const creado = pendingCaso.archivos[pendingCaso.archivos.length - 1];
  const enq = await enqueueAlfaClaimDocumentAfterUpload({
    caso: pendingCaso,
    archivo: creado,
    req: mockReq({
      s3Key,
      originalName: fileName,
      mimetype: 'text/plain; charset=utf-8',
      size: body.length,
    }),
    etiqueta: 'GENERAL',
  });
  const docId = enq?.documentId || enq?.document?._id;
  const doc = docId ? await ClaimDocument.findById(docId).lean() : null;
  const sync = docId ? await syncClaimDocument(docId) : null;

  // Must NOT create invalid folder
  let badFolderExists = false;
  try {
    const bad = await getFolderByPath(
      'SEGUROS ALFA/PÓLIZAS/99887766 - POR CONFIRMAR OPERACIONES'
    );
    badFolderExists = Boolean(bad?.id);
  } catch {
    badFolderExists = false;
  }

  const pendingOk =
    doc?.destinationStatus === 'pending_destination' &&
    doc?.destinationReason === 'MISSING_REAL_POLICY_NUMBER' &&
    !badFolderExists &&
    (sync?.result === 'PENDING_DESTINATION' || doc?.sharepoint?.itemId == null);

  checks.pendingDestination = pendingOk ? 'PASS' : 'FAIL';
  line(
    JSON.stringify(
      {
        destinationStatus: doc?.destinationStatus,
        destinationReason: doc?.destinationReason,
        syncResult: sync?.result,
        badFolderExists,
        s3Key,
        claimId: docId ? String(docId) : null,
      },
      null,
      2
    )
  );
  line(`PENDING_DESTINATION: ${checks.pendingDestination}`);

  // cleanup fixture case docs (keep S3 optional; delete claim + caso)
  if (docId) await ClaimDocument.deleteOne({ _id: docId });
  await SegurosAlfaCaso.deleteOne({ _id: pendingCaso._id });
  try {
    await s3.deleteObject(s3Key);
  } catch {
    /* ignore */
  }
} catch (err) {
  line(`PENDING_DESTINATION: FAIL ${err.message}`);
  if (pendingCaso?._id) {
    try {
      await SegurosAlfaCaso.deleteOne({ _id: pendingCaso._id });
    } catch {
      /* ignore */
    }
  }
}

// 10) Excel regression
line('');
line('--- 10) EXCEL R–AB REGRESSION ---');
const excelOk =
  outboundCfg.cronEnabled === true &&
  process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED === 'true' &&
  process.env.SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED === 'false' &&
  String(outboundCfg.rootPath || '').includes('CONTROL Y SEGUIMIENTO');
checks.excelRegression = excelOk ? 'PASS' : 'FAIL';
line(
  JSON.stringify(
    {
      outboundEnabled: outboundCfg.cronEnabled,
      outboundCron: outboundCfg.cronSchedule,
      outboundRoot: outboundCfg.rootPath,
      outboundFile: outboundCfg.fileName,
      inboundMonitor: process.env.SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED,
      antiLoopField: 'lastArnaldWrittenEtag (untouched by doc architecture)',
    },
    null,
    2
  )
);
line(`EXCEL R–AB REGRESSION: ${checks.excelRegression}`);

// 11) Históricos
line('');
line('--- 11) HISTÓRICOS INTACTOS ---');
const hist = await verifyHistoricosIntactos();
const histOk =
  hist.some((h) => h.path === 'SEGUROS ALFA/SINIESTROS' && h.exists) &&
  hist.some((h) => h.path === 'SEGUROS ALFA/SINIESTROS/PENDIENTES_NUMERO_SINIESTRO' && h.exists) &&
  hist.some((h) => h.path === 'SEGUROS ALFA/SINIESTROS/88187559' && h.exists);
// SINIESTROS/SEGUROS ALFA puede no existir como carpeta viva; lo que importa es no haber migrado/borrado SEGUROS ALFA/SINIESTROS/**
checks.historicos = histOk ? 'PASS' : 'FAIL';
line(JSON.stringify(hist, null, 2));
line(`HISTÓRICOS INTACTOS: ${checks.historicos}`);

// List physical subfolders under new root
line('');
line('--- SHAREPOINT ROOT PILOTO ---');
try {
  const rootFolder = await getFolderByPath(ROOT);
  const childrenRaw = await listFolder(ROOT, { top: 50 });
  const children = Array.isArray(childrenRaw) ? childrenRaw : childrenRaw?.children || [];
  line(
    JSON.stringify(
      {
        root: ROOT,
        rootId: rootFolder?.id || null,
        subfolders: children
          .filter((c) => c.folder)
          .map((c) => c.name)
          .sort(),
      },
      null,
      2
    )
  );
} catch (err) {
  line(`Root list error: ${err.message}`);
}

line('');
line('=== TABLA RESULTADOS ===');
line('TIPO | ARCHIVO | S3 | CLAIM/POLICY | RUTA SP | STATUS | ITEMID | PASS');
for (const r of results) {
  line(
    [
      r.tipo,
      r.archivo,
      r.s3 ? 'OK' : 'NO',
      r.claimOrPolicy || '-',
      r.rutaSp || '-',
      r.status || '-',
      r.itemId || '-',
      r.pass ? 'PASS' : 'FAIL',
    ].join(' | ')
  );
}

line('');
line(`ARCHIVERO UNIFICADO: ${checks.archivero}`);
line(`PENDING_DESTINATION: ${checks.pendingDestination}`);
line(`EXCEL R–AB REGRESSION: ${checks.excelRegression}`);
line(`HISTÓRICOS INTACTOS: ${checks.historicos}`);

const allUploadsPass = results.every((r) => r.pass);
e2ePass =
  flagsOk &&
  allUploadsPass &&
  checks.archivero === 'PASS' &&
  checks.pendingDestination === 'PASS' &&
  checks.excelRegression === 'PASS' &&
  checks.historicos === 'PASS';

line('');
line(e2ePass ? 'E2E DOCUMENTAL ALFA: PASSED' : 'E2E DOCUMENTAL ALFA: FAILED');
line('NO MIGRATION — históricos intactos por diseño.');
} finally {
  try {
    if (caso) await cleanupTestArtifacts(caso);
  } catch (e) {
    line(`CLEANUP ERROR: ${e.message}`);
  }
  await mongoose.disconnect();
}

process.exit(e2ePass ? 0 : 1);
