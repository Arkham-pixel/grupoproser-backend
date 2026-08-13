/**
 * FASE 4 — Prueba del modelo ClaimDocument y estados de sync (solo Mongo).
 *
 * Uso: node scripts/testClaimDocumentModel.js
 *
 * NO toca S3 ni SharePoint.
 * NO conecta módulos de siniestros reales.
 */
import dns from 'dns';
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';
import {
  createDocumentRecord,
  markSyncing,
  markSynced,
  markSyncFailed,
  getDocumentById,
} from '../services/claimDocumentService.js';
import { buildSharePointClaimPath } from '../utils/sharepointClaimPath.js';
import { getBucketName } from '../services/s3StorageService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const S3_KEY = 'test/sharepoint-sync/arnald-s3-test.txt';
const TEST_CLAIM_ID = new mongoose.Types.ObjectId();

function line(msg) {
  console.log(msg);
}

async function main() {
  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI no definido');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  line('Mongo connection: OK');

  // Forzar creación de índices del modelo
  await ClaimDocument.init();
  line('ClaimDocument model: OK');

  const pathPreview = buildSharePointClaimPath({
    insurer: 'TEST',
    claimNumber: 'TEST-ARNALD-001',
    documentType: 'poliza',
  });
  line(`path builder preview: ${pathPreview}`);
  if (pathPreview !== 'SINIESTROS/TEST/TEST-ARNALD-001/02_POLIZA') {
    throw new Error(`path builder inesperado: ${pathPreview}`);
  }

  const bucket = getBucketName() || 'test-bucket-placeholder';

  line('');
  line('--- Create pending ---');
  const pending = await createDocumentRecord({
    sourceModule: 'other',
    claimId: TEST_CLAIM_ID,
    claimNumber: 'TEST-ARNALD-001',
    insurer: 'TEST',
    documentType: 'poliza',
    originalName: 'arnald-s3-test.txt',
    storedName: 'arnald-s3-test.txt',
    mimeType: 'text/plain; charset=utf-8',
    size: 42,
    checksum: {
      algorithm: 'sha256',
      value: '29e9964bd5429183c29f15256dc9e3019999fd91a2ce45f2783cc58658bdfa9a',
    },
    storage: {
      bucket,
      key: S3_KEY,
      etag: 'phase4-test',
    },
    sharepointEnabled: true,
  });

  line('Create pending document: OK');
  line(`id: ${pending._id}`);
  line(`syncStatus: ${pending.sharepoint.syncStatus}`);
  if (pending.sharepoint.syncStatus !== 'pending') {
    throw new Error('Se esperaba syncStatus=pending');
  }

  line('');
  line('--- markSyncing ---');
  const syncing = await markSyncing(pending._id);
  line('markSyncing: OK');
  line(`syncStatus: ${syncing.sharepoint.syncStatus}`);
  if (syncing.sharepoint.syncStatus !== 'syncing') {
    throw new Error('Se esperaba syncStatus=syncing');
  }

  line('');
  line('--- markSynced ---');
  const synced = await markSynced(pending._id, {
    siteId: 'TEST_SITE_ID',
    driveId: 'TEST_DRIVE_ID',
    itemId: 'TEST_ITEM_ID',
    parentItemId: 'TEST_PARENT_ID',
    path: pathPreview,
    webUrl: 'https://example.invalid/TEST_ARNALD/fake',
  });
  line('markSynced: OK');
  line(`syncStatus: ${synced.sharepoint.syncStatus}`);
  line(`itemId: ${synced.sharepoint.itemId}`);
  line(`syncedAt: ${synced.sharepoint.syncedAt?.toISOString?.() || synced.sharepoint.syncedAt}`);
  if (synced.sharepoint.syncStatus !== 'synced' || synced.sharepoint.itemId !== 'TEST_ITEM_ID') {
    throw new Error('markSynced no persistió campos esperados');
  }
  if (synced.sharepoint.lastError?.code || synced.sharepoint.lastError?.message) {
    throw new Error('lastError debería quedar limpio tras synced');
  }

  // Idempotencia: markSyncing sobre synced no debe degradar
  const again = await markSyncing(pending._id);
  if (again.sharepoint.syncStatus !== 'synced') {
    throw new Error('Idempotencia falló: synced no debe pasar a syncing');
  }
  line('Idempotencia synced→markSyncing: OK');

  line('');
  line('--- Failure test ---');
  const failDoc = await createDocumentRecord({
    sourceModule: 'other',
    claimId: TEST_CLAIM_ID,
    claimNumber: 'TEST-ARNALD-001',
    insurer: 'TEST',
    documentType: 'soporte',
    originalName: 'fail-case.txt',
    mimeType: 'text/plain',
    size: 10,
    storage: {
      bucket,
      key: `${S3_KEY}.fail-case`,
    },
  });
  // attempts se incrementa al iniciar el intento (lock), no en markSyncFailed
  await ClaimDocument.updateOne(
    { _id: failDoc._id },
    {
      $set: {
        'sharepoint.syncStatus': 'syncing',
        'sharepoint.attempts': 1,
        'sharepoint.lastAttemptAt': new Date(),
      },
    }
  );
  const failed = await markSyncFailed(failDoc._id, {
    code: 'SHAREPOINT_UPLOAD_ERROR',
    message: 'Simulated Graph failure (phase 4)',
    status: 503,
  });
  line('Failure test: OK');
  line(`syncStatus: ${failed.sharepoint.syncStatus}`);
  line(`attempts: ${failed.sharepoint.attempts}`);
  line(
    `lastError: ${failed.sharepoint.lastError?.code} / ${failed.sharepoint.lastError?.message}`
  );
  if (
    failed.sharepoint.syncStatus !== 'failed' ||
    failed.sharepoint.attempts !== 1 ||
    !failed.sharepoint.lastError?.code
  ) {
    throw new Error('markSyncFailed no persistió el estado esperado');
  }

  line('');
  line('--- Indexes ---');
  const indexes = await ClaimDocument.collection.indexes();
  const indexNames = indexes.map((i) => JSON.stringify(i.key));
  line(`indexes count: ${indexes.length}`);
  const requiredKeys = [
    '{"claimId":1,"status":1}',
    '{"sourceModule":1,"claimId":1}',
    '{"sharepoint.syncStatus":1,"sharepoint.nextRetryAt":1}',
    '{"storage.bucket":1,"storage.key":1}',
    '{"sharepoint.itemId":1}',
  ];
  for (const key of requiredKeys) {
    const ok = indexNames.some((n) => n === key);
    line(`index ${key}: ${ok ? 'OK' : 'MISSING'}`);
    if (!ok) throw new Error(`Falta índice ${key}`);
  }
  line('Indexes: OK');

  line('');
  line('--- Cleanup ---');
  const del = await ClaimDocument.deleteMany({
    sourceModule: 'other',
    claimNumber: 'TEST-ARNALD-001',
    insurer: 'TEST',
  });
  line(`Cleanup test records: OK (deleted=${del.deletedCount})`);

  // Verificar getDocumentById sobre borrado
  const gone = await getDocumentById(pending._id);
  if (gone) throw new Error('El documento de prueba aún existe tras cleanup');

  line('');
  line('FASE 4: PASSED');
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('');
  console.error('FASE 4: FAILED');
  console.error(error.message || error);
  try {
    await ClaimDocument.deleteMany({
      sourceModule: 'other',
      claimNumber: 'TEST-ARNALD-001',
      insurer: 'TEST',
    });
  } catch {
    /* ignore */
  }
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
