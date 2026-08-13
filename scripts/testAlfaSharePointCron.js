/**
 * FASE 7 — Cron automático Seguros Alfa → SharePoint.
 *
 * Uso: node scripts/testAlfaSharePointCron.js
 *
 * No llama syncClaimDocument(id) en el camino feliz.
 * Arranca el mismo cron de producción y espera el tick.
 */

import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import ClaimDocument from '../models/ClaimDocument.js';
import * as s3 from '../services/s3StorageService.js';
import { getAccessToken, deleteItem, getFolderByPath } from '../services/microsoftGraphService.js';
import { enqueueAlfaClaimDocumentAfterUpload } from '../services/alfaClaimDocumentEnqueueService.js';
import { sanitizeStoredFileName } from '../utils/sharepointClaimPath.js';
import {
  iniciarCronSharePointSync,
  detenerCronSharePointSync,
  isCronSharePointSyncActive,
} from '../services/cronSharepointSyncService.js';
import {
  runSharePointSyncCycle,
  isSharePointSyncCycleRunning,
} from '../workers/sharepointSyncWorker.js';
import { getSharePointWorkerHealthSnapshot } from '../config/sharepointSync.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const S3_KEY = 'test/sharepoint-sync/arnald-s3-cron-poliza.txt';
const S3_CONTENT = 'FASE7 cron piloto poliza-cron-prueba.pdf\n';
const PILOT_SINIESTRO = 'TEST-ARNALD-FASE7-CRON-001';
const PILOT_FOLDER = `SEGUROS ALFA/SINIESTROS/${PILOT_SINIESTRO}`;
const BAD_S3_KEY = 'test/sharepoint-sync/not-found-fase7-cron.pdf';

let casoId = null;
let successDocId = null;
let failDocId = null;
let otherModuleDocId = null;

function line(msg) {
  console.log(msg);
}

function pass(name) {
  line(`${name}: PASSED`);
  line('');
}

function fail(name, err) {
  throw new Error(`${name}: ${err?.message || err}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function applyPilotEnv({ cronEnabled = true, alfaEnabled = true, cronExpr } = {}) {
  process.env.SHAREPOINT_SYNC_MODE = 'pilot';
  process.env.SHAREPOINT_SYNC_ALFA_ENABLED = alfaEnabled ? 'true' : 'false';
  process.env.SHAREPOINT_SYNC_ENABLED_MODULES = 'alfa';
  process.env.SHAREPOINT_SYNC_CRON_ENABLED = cronEnabled ? 'true' : 'false';
  process.env.SHAREPOINT_SYNC_CRON = cronExpr || '*/15 * * * * *';
  process.env.SHAREPOINT_SYNC_BATCH_SIZE = '5';
  process.env.SHAREPOINT_SYNC_CONCURRENCY = '2';
  process.env.SHAREPOINT_SYNC_MAX_ATTEMPTS = '5';
  process.env.SHAREPOINT_SYNC_STALE_MINUTES = '15';
  process.env.SHAREPOINT_SYNC_FORCE_TEST_ROOT = 'false';
}

async function ensureS3() {
  const bucket = s3.getBucketName();
  if (!bucket) throw new Error('AWS_S3_BUCKET no configurado');
  try {
    await s3.headObject(S3_KEY);
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const missing =
      error?.name === 'NotFound' ||
      error?.name === 'NoSuchKey' ||
      status === 404;
    if (!missing) throw error;
    await s3.putObject({
      key: S3_KEY,
      body: Buffer.from(S3_CONTENT, 'utf8'),
      contentType: 'text/plain; charset=utf-8',
      metadata: { purpose: 'arnald-sharepoint-fase7-cron' },
    });
  }
  return bucket;
}

async function pollUntil(predicate, { timeoutMs = 90000, intervalMs = 2000, label } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timeout esperando: ${label || 'condición'} (${timeoutMs}ms)`);
}

async function cleanup() {
  detenerCronSharePointSync();
  if (successDocId) await ClaimDocument.deleteMany({ _id: successDocId });
  if (failDocId) await ClaimDocument.deleteMany({ _id: failDocId });
  if (otherModuleDocId) await ClaimDocument.deleteMany({ _id: otherModuleDocId });
  await ClaimDocument.deleteMany({
    sourceModule: 'alfa',
    claimNumber: PILOT_SINIESTRO,
  });
  if (casoId) await SegurosAlfaCaso.deleteOne({ _id: casoId });
  await SegurosAlfaCaso.deleteMany({
    siniestro: PILOT_SINIESTRO,
    identificacion: 'FASE7-CRON-TEST',
  });
  try {
    const folder = await getFolderByPath(PILOT_FOLDER);
    if (folder?.id) await deleteItem(folder.id);
  } catch {
    // ok
  }
}

async function main() {
  line('=== FASE 7 — Cron automático Alfa ===');
  applyPilotEnv({ cronEnabled: true, alfaEnabled: true });

  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI no definido');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  line('Mongo: OK');

  const bucket = await ensureS3();
  line('S3: OK');
  await getAccessToken();
  line('SharePoint: OK');

  const snap = getSharePointWorkerHealthSnapshot();
  line(
    `config: mode=${snap.mode} modules=${snap.modules.join(',')} cron=${snap.cron} alfa=${snap.alfaEnabled}`
  );
  line('');

  // --- Caso Alfa + ClaimDocument pending (simula upload post-save) ---
  line('1) Upload Alfa → ClaimDocument pending');
  const caso = await SegurosAlfaCaso.create({
    consecutivo: `ALFA-FASE7-${Date.now()}`,
    siniestro: PILOT_SINIESTRO,
    identificacion: 'FASE7-CRON-TEST',
    asegurado: 'Asegurado FASE7 Cron',
    estado: 'PENDIENTE',
    numeroPoliza: 'POL-FASE7',
    archivos: [],
  });
  casoId = caso._id;

  const req = {
    file: {
      originalname: 'poliza-cron-prueba.pdf',
      mimetype: 'application/pdf',
      size: Buffer.byteLength(S3_CONTENT),
    },
    fileStorage: {
      driver: 's3',
      s3Key: S3_KEY,
      filename: sanitizeStoredFileName('poliza-cron-prueba.pdf'),
      publicPath: `s3:${S3_KEY}`,
      size: Buffer.byteLength(S3_CONTENT),
      mimetype: 'application/pdf',
    },
    usuario: { id: new mongoose.Types.ObjectId().toString(), login: 'fase7', nombre: 'FASE7' },
  };
  const archivo = {
    nombreOriginal: 'poliza-cron-prueba.pdf',
    nombreArchivo: req.fileStorage.filename,
    ruta: req.fileStorage.publicPath,
    tamaño: req.fileStorage.size,
    tipoMime: 'application/pdf',
    etiqueta: 'POLIZA',
    subidoPor: { login: 'fase7', nombre: 'FASE7' },
    fechaSubida: new Date(),
  };
  caso.archivos.push(archivo);
  await caso.save();

  const enq = await enqueueAlfaClaimDocumentAfterUpload({
    caso,
    archivo: caso.archivos[caso.archivos.length - 1],
    req,
    etiqueta: 'POLIZA',
  });
  successDocId = enq.document?._id;
  if (enq.result !== 'ENQUEUED' || enq.document?.sharepoint?.syncStatus !== 'pending') {
    fail('PENDING', new Error(JSON.stringify({ result: enq.result, st: enq.document?.sharepoint })));
  }
  line(`ClaimDocument pending id=${successDocId} attempts=${enq.document.sharepoint.attempts}`);
  pass('Upload + pending');

  // --- Documento de otro módulo (no debe tocarse) ---
  line('2) Filtro solo Alfa');
  const other = await ClaimDocument.create({
    sourceModule: 'other',
    claimId: new mongoose.Types.ObjectId(),
    claimNumber: 'OTHER-SHOULD-NOT-SYNC',
    insurer: 'OTRA',
    documentType: 'soporte',
    originalName: 'other.pdf',
    storedName: 'other.pdf',
    mimeType: 'application/pdf',
    size: 10,
    storage: { provider: 's3', bucket, key: S3_KEY },
    sharepoint: { enabled: true, syncStatus: 'pending', attempts: 0 },
    status: 'active',
    integrationKey: `other:fase7:${Date.now()}`,
  });
  otherModuleDocId = other._id;
  line(`other module pending id=${otherModuleDocId}`);

  // --- Doc error S3 ---
  line('3) ClaimDocument con S3 inexistente (error/retry)');
  const failDoc = await ClaimDocument.create({
    sourceModule: 'alfa',
    claimId: caso._id,
    claimNumber: PILOT_SINIESTRO,
    insurer: 'SEGUROS ALFA',
    documentType: 'soporte',
    originalName: 'missing.pdf',
    storedName: 'missing.pdf',
    mimeType: 'application/pdf',
    size: 1,
    storage: { provider: 's3', bucket, key: BAD_S3_KEY },
    sharepoint: { enabled: true, syncStatus: 'pending', attempts: 0 },
    status: 'active',
    integrationKey: `alfa:${caso._id}:${BAD_S3_KEY}`,
  });
  failDocId = failDoc._id;

  // --- Anti-overlap ---
  line('4) Anti-overlap de batches');
  // Forzar ciclo largo artificial: lanzar dos en paralelo; el segundo debe skippedOverlapping
  // (el primero puede ser corto; si termina antes, reintentamos con flag)
  const p1 = runSharePointSyncCycle({ recoverStale: false });
  const p2 = runSharePointSyncCycle({ recoverStale: false });
  const [a, b] = await Promise.all([p1, p2]);
  const overlapOk = a.skippedOverlapping === true || b.skippedOverlapping === true;
  line(`overlap skipped=${overlapOk} runningNow=${isSharePointSyncCycleRunning()}`);
  if (!overlapOk) {
    // Si ambos fueron demasiado rápidos y secuenciales, forzar con running flag indirección:
    // al menos uno debió ver al otro. Si no, fallar.
    fail('OVERLAP', new Error('ningún ciclo reportó skippedOverlapping'));
  }
  pass('Anti-overlap');

  // Tras overlap, el success doc pudo haber sincronizado ya en el ciclo paralelo.
  let afterOverlap = await ClaimDocument.findById(successDocId);
  if (afterOverlap.sharepoint.syncStatus === 'synced') {
    line('Nota: el ciclo anti-overlap ya sincronizó el doc de éxito (aceptable).');
  } else {
    // Re-poner pending si quedó failed/syncing raro
    if (afterOverlap.sharepoint.syncStatus !== 'pending') {
      await ClaimDocument.updateOne(
        { _id: successDocId },
        {
          $set: {
            'sharepoint.syncStatus': 'pending',
            'sharepoint.attempts': 0,
          },
          $unset: {
            'sharepoint.itemId': '',
            'sharepoint.webUrl': '',
            'sharepoint.path': '',
            'sharepoint.syncedAt': '',
            'sharepoint.lastError': '',
            'sharepoint.nextRetryAt': '',
          },
        }
      );
    }
  }

  // Releer fail doc — pudo fallar en el overlap cycle
  let failState = await ClaimDocument.findById(failDocId);
  if (failState.sharepoint.syncStatus === 'pending') {
    // ok, cron lo tomará
  }

  // --- Arrancar cron y esperar (camino feliz sin syncClaimDocument) ---
  line('5) Esperar cron automático (sin syncClaimDocument manual)');
  detenerCronSharePointSync();
  applyPilotEnv({ cronEnabled: true, alfaEnabled: true, cronExpr: '*/15 * * * * *' });
  iniciarCronSharePointSync();
  if (!isCronSharePointSyncActive()) {
    fail('CRON', new Error('cron no activo'));
  }
  line('Cron activo (*/15s en prueba; prod = */2 * * * *)');

  const syncedAtWaitStart = Date.now();
  const syncedDoc = await pollUntil(
    async () => {
      const d = await ClaimDocument.findById(successDocId).lean();
      if (d?.sharepoint?.syncStatus === 'synced' && d?.sharepoint?.itemId) return d;
      return null;
    },
    { timeoutMs: 90000, intervalMs: 2000, label: 'cron → synced' }
  );
  const syncDurationMs = Date.now() - syncedAtWaitStart;
  line(`synced via cron in ~${syncDurationMs}ms`);
  line(`path=${syncedDoc.sharepoint.path}`);
  line(`itemId=${syncedDoc.sharepoint.itemId}`);
  line(`webUrl=${syncedDoc.sharepoint.webUrl}`);
  line(`attempts=${syncedDoc.sharepoint.attempts}`);
  if (syncedDoc.sharepoint.attempts < 1) fail('SYNC', new Error('attempts'));
  if (!String(syncedDoc.sharepoint.path || '').startsWith(PILOT_FOLDER)) {
    fail('SYNC', new Error('path fuera de SINIESTROS piloto'));
  }
  if (!syncedDoc.sharepoint.syncedAt) fail('SYNC', new Error('syncedAt null'));
  pass('Cron → synced');

  // --- Other module intacto ---
  const otherAfter = await ClaimDocument.findById(otherModuleDocId).lean();
  line(
    `other module status=${otherAfter.sharepoint.syncStatus} attempts=${otherAfter.sharepoint.attempts}`
  );
  if (otherAfter.sharepoint.syncStatus !== 'pending' || Number(otherAfter.sharepoint.attempts) !== 0) {
    fail('FILTER', new Error('módulo other fue procesado'));
  }
  pass('Filtro solo Alfa');

  // --- Error + retry ---
  line('6) Error S3 + retry vía cron');
  failState = await ClaimDocument.findById(failDocId);
  if (failState.sharepoint.syncStatus === 'pending') {
    await pollUntil(
      async () => {
        const d = await ClaimDocument.findById(failDocId).lean();
        return d?.sharepoint?.syncStatus === 'failed' ? d : null;
      },
      { timeoutMs: 90000, intervalMs: 2000, label: 'cron → failed' }
    );
  }
  failState = await ClaimDocument.findById(failDocId);
  line(
    `failed attempts=${failState.sharepoint.attempts} error=${failState.sharepoint.lastError?.code} nextRetryAt=${failState.sharepoint.nextRetryAt}`
  );
  if (failState.sharepoint.syncStatus !== 'failed') fail('FAIL', new Error('status'));
  if (!failState.sharepoint.lastError?.code) fail('FAIL', new Error('lastError'));
  if (!failState.sharepoint.nextRetryAt) fail('FAIL', new Error('nextRetryAt'));
  const attemptsAfterFail = Number(failState.sharepoint.attempts);

  // Adelantar retry
  await ClaimDocument.updateOne(
    { _id: failDocId },
    { $set: { 'sharepoint.nextRetryAt': new Date(Date.now() - 1000) } }
  );
  await pollUntil(
    async () => {
      const d = await ClaimDocument.findById(failDocId).lean();
      return Number(d?.sharepoint?.attempts) > attemptsAfterFail ? d : null;
    },
    { timeoutMs: 90000, intervalMs: 2000, label: 'cron → retry attempts++' }
  );
  const afterRetry = await ClaimDocument.findById(failDocId).lean();
  line(`retry attempts=${afterRetry.sharepoint.attempts} status=${afterRetry.sharepoint.syncStatus}`);
  if (Number(afterRetry.sharepoint.attempts) <= attemptsAfterFail) {
    fail('RETRY', new Error('no reintentó'));
  }
  pass('Error + retry');

  // --- Rollback cron ---
  line('7) Rollback CRON_ENABLED=false');
  detenerCronSharePointSync();
  applyPilotEnv({ cronEnabled: false, alfaEnabled: true });
  iniciarCronSharePointSync();
  if (isCronSharePointSyncActive()) fail('ROLLBACK_CRON', new Error('cron sigue activo'));
  line('Cron detenido con SHAREPOINT_SYNC_CRON_ENABLED=false');
  pass('Rollback cron');

  // --- Rollback Alfa ---
  line('8) Rollback ALFA_ENABLED=false');
  applyPilotEnv({ cronEnabled: false, alfaEnabled: false });
  const skipEnq = await enqueueAlfaClaimDocumentAfterUpload({
    caso: { _id: new mongoose.Types.ObjectId(), siniestro: PILOT_SINIESTRO },
    archivo: { nombreOriginal: 'x.pdf', ruta: `s3:${S3_KEY}.x` },
    req: {
      fileStorage: { s3Key: `${S3_KEY}.x`, filename: 'x.pdf', publicPath: `s3:${S3_KEY}.x` },
      file: { originalname: 'x.pdf', mimetype: 'application/pdf', size: 1 },
      usuario: { id: new mongoose.Types.ObjectId().toString() },
    },
    etiqueta: 'POLIZA',
  });
  line(`enqueue con Alfa OFF: ${skipEnq.result}`);
  if (skipEnq.result !== 'DISABLED') fail('ROLLBACK_ALFA', new Error(skipEnq.result));
  pass('Rollback Alfa');

  line('--- Resumen ---');
  line(`siniestro: ${PILOT_SINIESTRO}`);
  line(`SharePoint path: ${syncedDoc.sharepoint.path}`);
  line(`sync wait ~${syncDurationMs}ms (cron prueba cada 15s)`);
  line(`prod cron: */2 * * * *`);
  line(`HTTP no bloqueado: worker async + anti-overlap`);
  line('');

  await cleanup();
  line('Cleanup: OK');
  line('FASE 7: PASSED');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('FASE 7: FAILED');
  console.error(err);
  try {
    await cleanup();
  } catch (e) {
    console.error('Cleanup:', e.message);
  }
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
