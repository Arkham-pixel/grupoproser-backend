/**
 * FASE 5 — Worker ClaimDocument S3 → SharePoint (TEST_ARNALD/WORKER_TEST).
 *
 * Uso: node scripts/testClaimDocumentSyncWorker.js
 *
 * No borra el objeto S3 de prueba ni la raíz TEST_ARNALD.
 */

import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';
import * as s3 from '../services/s3StorageService.js';
import { getAccessToken, deleteItem, getFolderByPath } from '../services/microsoftGraphService.js';
import { getSharePointTestRoot, assertTestPath } from '../utils/sharepointTestPath.js';
import { getSharePointSyncConfig } from '../config/sharepointSync.js';
import {
  createDocumentRecord,
  acquireSyncLock,
  recoverStaleSyncDocuments,
  getDocumentById,
} from '../services/claimDocumentService.js';
import { syncClaimDocument } from '../services/claimDocumentSyncService.js';
import { runSharePointSyncCycle } from '../workers/sharepointSyncWorker.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const S3_KEY = 'test/sharepoint-sync/arnald-s3-test.txt';
const S3_CONTENT = 'Prueba ARNALD S3 → Microsoft SharePoint\n';
const TEST_CLAIM_ID = new mongoose.Types.ObjectId();
const WORKER_ROOT = `${getSharePointTestRoot()}/WORKER_TEST`;

const createdIds = [];

function line(msg) {
  console.log(msg);
}

function pass(name) {
  line(`${name}: PASSED`);
  line('');
}

function fail(name, err) {
  line(`${name}: FAILED — ${err.message || err}`);
  throw err;
}

async function ensureS3TestObject() {
  const bucket = s3.getBucketName();
  if (!bucket) throw new Error('AWS_S3_BUCKET no configurado');
  try {
    await s3.headObject(S3_KEY);
    return { created: false, bucket };
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const missing =
      error?.name === 'NotFound' ||
      error?.name === 'NoSuchKey' ||
      status === 404;
    if (!missing) throw error;
  }
  await s3.putObject({
    key: S3_KEY,
    body: Buffer.from(S3_CONTENT, 'utf8'),
    contentType: 'text/plain; charset=utf-8',
    metadata: { purpose: 'arnald-sharepoint-phase5-worker-test' },
  });
  return { created: true, bucket };
}

async function cleanupSharePointWorkerTest() {
  assertTestPath(WORKER_ROOT);
  try {
    const folder = await getFolderByPath(WORKER_ROOT);
    if (folder?.id) {
      await deleteItem(folder.id);
      return { deleted: 1 };
    }
  } catch {
    return { deleted: 0 };
  }
  return { deleted: 0 };
}

async function cleanupMongo() {
  if (!createdIds.length) return 0;
  const r = await ClaimDocument.deleteMany({ _id: { $in: createdIds } });
  return r.deletedCount || 0;
}

async function trackCreate(input) {
  const doc = await createDocumentRecord(input);
  createdIds.push(doc._id);
  return doc;
}

async function main() {
  process.env.SHAREPOINT_SYNC_FORCE_TEST_ROOT =
    process.env.SHAREPOINT_SYNC_FORCE_TEST_ROOT || 'true';

  const cfg = getSharePointSyncConfig();
  line('=== FASE 5 — ClaimDocument sync worker ===');
  line(`maxAttempts=${cfg.maxAttempts} staleMinutes=${cfg.staleMinutes}`);
  line(`batchSize=${cfg.batchSize} concurrency=${cfg.concurrency}`);
  line(`forceTestRoot=${cfg.forceTestRoot}`);
  line(`workerRoot=${WORKER_ROOT}`);
  line('');

  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI no definido');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  line('Mongo connection: OK');

  const ensured = await ensureS3TestObject();
  line('S3 connection: OK');
  line(`s3 key: ${S3_KEY} (${ensured.created ? 'created' : 'exists'})`);

  await getAccessToken();
  line('SharePoint connection: OK');
  line('');

  // ---------- TEST A ----------
  line('TEST A:');
  const docA = await trackCreate({
    sourceModule: 'other',
    claimId: TEST_CLAIM_ID,
    claimNumber: 'TEST-WORKER-001',
    insurer: 'TEST',
    documentType: 'poliza',
    originalName: 'arnald-s3-test.txt',
    storedName: 'arnald-s3-test.txt',
    mimeType: 'text/plain; charset=utf-8',
    size: Buffer.byteLength(S3_CONTENT, 'utf8'),
    storage: { bucket: ensured.bucket, key: S3_KEY },
  });
  line(`documentId: ${docA._id}`);
  line(`initial: ${docA.sharepoint.syncStatus}`);

  const rA = await syncClaimDocument(docA._id);
  const afterA = await getDocumentById(docA._id);
  line(`pending → syncing → ${afterA.sharepoint.syncStatus}`);
  line(`attempts: ${afterA.sharepoint.attempts}`);
  line(`itemId: ${afterA.sharepoint.itemId}`);
  line(`webUrl: ${afterA.sharepoint.webUrl}`);
  line(`syncedAt: ${afterA.sharepoint.syncedAt}`);

  if (rA.result !== 'synced') fail('TEST A', new Error(`result=${rA.result}`));
  if (afterA.sharepoint.syncStatus !== 'synced') fail('TEST A', new Error('status'));
  if (afterA.sharepoint.attempts !== 1) fail('TEST A', new Error('attempts != 1'));
  if (!afterA.sharepoint.itemId) fail('TEST A', new Error('itemId null'));
  if (!afterA.sharepoint.webUrl) fail('TEST A', new Error('webUrl null'));
  if (!afterA.sharepoint.syncedAt) fail('TEST A', new Error('syncedAt null'));
  if (afterA.sharepoint.lastError?.code) fail('TEST A', new Error('lastError presente'));
  if (!String(afterA.sharepoint.path || '').startsWith(WORKER_ROOT)) {
    fail('TEST A', new Error(`path fuera de ${WORKER_ROOT}: ${afterA.sharepoint.path}`));
  }
  pass('TEST A');

  // ---------- TEST B ----------
  line('TEST B:');
  const itemIdBefore = afterA.sharepoint.itemId;
  const rB = await syncClaimDocument(docA._id);
  const afterB = await getDocumentById(docA._id);
  line(`second execution: ${rB.result}`);
  line(`duplicate SharePoint file: false (itemId estable=${afterB.sharepoint.itemId === itemIdBefore})`);
  if (!['SKIPPED', 'SKIPPED_ALREADY_SYNCED', 'SKIPPED_RECONCILED'].includes(rB.result)) {
    fail('TEST B', new Error(`expected SKIPPED*, got ${rB.result}`));
  }
  if (afterB.sharepoint.itemId !== itemIdBefore) {
    fail('TEST B', new Error('itemId cambió (posible duplicado)'));
  }
  if (afterB.sharepoint.attempts !== 1) {
    fail('TEST B', new Error('attempts incrementó en skip'));
  }
  pass('TEST B');

  // ---------- TEST C ----------
  line('TEST C:');
  const docC = await trackCreate({
    sourceModule: 'other',
    claimId: TEST_CLAIM_ID,
    claimNumber: 'TEST-WORKER-002',
    insurer: 'TEST',
    documentType: 'poliza',
    originalName: 'not-found.pdf',
    storedName: 'not-found.pdf',
    mimeType: 'application/pdf',
    size: 1,
    storage: {
      bucket: ensured.bucket,
      key: 'test/not-found-file.pdf',
    },
  });
  const rC = await syncClaimDocument(docC._id);
  const afterC = await getDocumentById(docC._id);
  line('S3 missing');
  line(`status: ${afterC.sharepoint.syncStatus}`);
  line(`attempts: ${afterC.sharepoint.attempts}`);
  line(`error: ${afterC.sharepoint.lastError?.code}`);
  line(`nextRetryAt: ${afterC.sharepoint.nextRetryAt}`);
  if (rC.result !== 'failed') fail('TEST C', new Error(rC.result));
  if (afterC.sharepoint.syncStatus !== 'failed') fail('TEST C', new Error('status'));
  if (afterC.sharepoint.attempts !== 1) fail('TEST C', new Error('attempts'));
  if (afterC.sharepoint.lastError?.code !== 'S3_OBJECT_NOT_FOUND') {
    fail('TEST C', new Error(`code=${afterC.sharepoint.lastError?.code}`));
  }
  if (!afterC.sharepoint.nextRetryAt) fail('TEST C', new Error('nextRetryAt null'));
  pass('TEST C');

  // ---------- TEST D ----------
  line('TEST D:');
  await ClaimDocument.updateOne(
    { _id: docC._id },
    { $set: { 'sharepoint.nextRetryAt': new Date(Date.now() - 1000) } }
  );
  const rD = await syncClaimDocument(docC._id);
  const afterD = await getDocumentById(docC._id);
  line('retry');
  line(`result: ${rD.result}`);
  line(`attempts: ${afterD.sharepoint.attempts}`);
  if (afterD.sharepoint.attempts !== 2) fail('TEST D', new Error('attempts != 2'));
  if (rD.result !== 'failed') fail('TEST D', new Error(`expected failed, got ${rD.result}`));
  pass('TEST D');

  // ---------- TEST E ----------
  line('TEST E:');
  await ClaimDocument.updateOne(
    { _id: docC._id },
    {
      $set: {
        'sharepoint.syncStatus': 'failed',
        'sharepoint.attempts': cfg.maxAttempts,
        'sharepoint.nextRetryAt': new Date(Date.now() - 1000),
        'sharepoint.lastError': { code: 'S3_OBJECT_NOT_FOUND', message: 'max sim' },
      },
    }
  );
  const rE = await syncClaimDocument(docC._id);
  line(`max attempts respected: ${rE.result}`);
  if (rE.result !== 'SKIP_MAX_ATTEMPTS') {
    fail('TEST E', new Error(`expected SKIP_MAX_ATTEMPTS, got ${rE.result}`));
  }
  const afterE = await getDocumentById(docC._id);
  if (afterE.sharepoint.attempts !== cfg.maxAttempts) {
    fail('TEST E', new Error('attempts mutated'));
  }
  pass('TEST E');

  // ---------- TEST F ----------
  line('TEST F:');
  const docF = await trackCreate({
    sourceModule: 'other',
    claimId: TEST_CLAIM_ID,
    claimNumber: 'TEST-WORKER-LOCK',
    insurer: 'TEST',
    documentType: 'poliza',
    originalName: 'arnald-s3-test.txt',
    storedName: 'lock-test.txt',
    mimeType: 'text/plain',
    size: Buffer.byteLength(S3_CONTENT, 'utf8'),
    storage: { bucket: ensured.bucket, key: S3_KEY },
  });
  const [lock1, lock2] = await Promise.all([
    acquireSyncLock(docF._id),
    acquireSyncLock(docF._id),
  ]);
  const winners = [lock1, lock2].filter((l) => l.ok);
  const skippers = [lock1, lock2].filter((l) => !l.ok);
  line(`atomic lock: winners=${winners.length} skippers=${skippers.length}`);
  line(`skip reason: ${skippers[0]?.reason}`);
  if (winners.length !== 1) fail('TEST F', new Error('expected exactly 1 lock'));
  if (skippers[0]?.reason !== 'SKIP_ALREADY_PROCESSING') {
    fail('TEST F', new Error(`expected SKIP_ALREADY_PROCESSING, got ${skippers[0]?.reason}`));
  }
  // liberar: marcar failed para cleanup coherente
  await ClaimDocument.updateOne(
    { _id: docF._id },
    {
      $set: {
        'sharepoint.syncStatus': 'failed',
        'sharepoint.lastError': { code: 'LOCK_TEST', message: 'released' },
      },
    }
  );
  pass('TEST F');

  // ---------- TEST G ----------
  line('TEST G:');
  const docG = await trackCreate({
    sourceModule: 'other',
    claimId: TEST_CLAIM_ID,
    claimNumber: 'TEST-WORKER-STALE',
    insurer: 'TEST',
    documentType: 'poliza',
    originalName: 'stale.txt',
    storedName: 'stale.txt',
    mimeType: 'text/plain',
    size: 1,
    storage: { bucket: ensured.bucket, key: S3_KEY },
  });
  await ClaimDocument.updateOne(
    { _id: docG._id },
    {
      $set: {
        'sharepoint.syncStatus': 'syncing',
        'sharepoint.attempts': 1,
        'sharepoint.lastAttemptAt': new Date(Date.now() - 30 * 60 * 1000),
      },
    }
  );
  const recovered = await recoverStaleSyncDocuments();
  const afterG = await getDocumentById(docG._id);
  line(`stale recovered count (batch): ${recovered.length}`);
  line(`status after recover: ${afterG.sharepoint.syncStatus}`);
  line(`lastError: ${afterG.sharepoint.lastError?.code}`);
  line(`nextRetryAt: ${afterG.sharepoint.nextRetryAt}`);
  if (afterG.sharepoint.syncStatus !== 'failed') {
    fail('TEST G', new Error('sigue syncing'));
  }
  if (afterG.sharepoint.lastError?.code !== 'STALE_SYNCING') {
    fail('TEST G', new Error('código esperado STALE_SYNCING'));
  }
  pass('TEST G');

  // smoke: un ciclo del worker no debe romper
  line('Worker cycle smoke:');
  const cycle = await runSharePointSyncCycle({ batchSize: 2, concurrency: 1, recoverStale: true });
  line(`claimed=${cycle.claimed} synced=${cycle.synced} failed=${cycle.failed}`);
  line('');

  line('--- Cleanup ---');
  const mongoDeleted = await cleanupMongo();
  const spClean = await cleanupSharePointWorkerTest();
  line(`Mongo test docs deleted: ${mongoDeleted}`);
  line(`SharePoint WORKER_TEST items deleted: ${spClean.deleted}`);
  line('Cleanup: OK');
  line('');
  line('FASE 5: PASSED');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('FASE 5: FAILED');
  console.error(err);
  try {
    await cleanupMongo();
    await cleanupSharePointWorkerTest();
  } catch (e) {
    console.error('Cleanup parcial falló:', e.message);
  }
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
