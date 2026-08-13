/**
 * FASE 3 — Sincronización aislada AWS S3 → SharePoint (TEST_ARNALD).
 *
 * Uso: node scripts/testS3ToSharePointSync.js
 *
 * - Crea (si falta) un objeto de prueba en S3 bajo test/sharepoint-sync/
 * - Lo sincroniza a TEST_ARNALD/S3_SYNC_TEST/
 * - Limpia SharePoint; NO borra el objeto S3
 */
import '../config/loadEnv.js';
import * as s3 from '../services/s3StorageService.js';
import {
  syncS3ObjectToSharePoint,
  SyncError,
} from '../services/sharepointSyncService.js';
import {
  getAccessToken,
  listFolder,
  deleteItem,
  getFolderByPath,
} from '../services/microsoftGraphService.js';
import { assertTestPath, getSharePointTestRoot } from '../utils/sharepointTestPath.js';

const S3_KEY = 'test/sharepoint-sync/arnald-s3-test.txt';
const S3_CONTENT = 'Prueba ARNALD S3 → Microsoft SharePoint\n';
const SP_FOLDER = 'TEST_ARNALD/S3_SYNC_TEST';
const SP_FILE = 'arnald-s3-test.txt';

function line(msg) {
  console.log(msg);
}

async function ensureS3TestObject() {
  const bucket = s3.getBucketName();
  if (!bucket) {
    throw new Error('AWS_S3_BUCKET no configurado');
  }

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
    metadata: { purpose: 'arnald-sharepoint-phase3-test' },
  });
  return { created: true, bucket };
}

async function main() {
  const root = getSharePointTestRoot();
  assertTestPath(SP_FOLDER);
  assertTestPath(`${SP_FOLDER}/${SP_FILE}`);

  line('--- 1) S3 ---');
  const ensured = await ensureS3TestObject();
  const head = await s3.headObject(S3_KEY);
  line('S3 connection: OK');
  line(`bucket: ${ensured.bucket}`);
  line(`key: ${S3_KEY}`);
  line(`size: ${head.ContentLength}`);
  line(`contentType: ${head.ContentType}`);
  line(`s3Object: ${ensured.created ? 'created' : 'exists'}`);
  line('');

  line('--- 2) Graph token ---');
  await getAccessToken();
  line('Token: OK');
  line('');

  line('--- 3) Sync S3 → SharePoint ---');
  line(`SharePoint destination: ${SP_FOLDER}/${SP_FILE}`);
  const result = await syncS3ObjectToSharePoint({
    bucket: ensured.bucket,
    key: S3_KEY,
    destinationPath: SP_FOLDER,
    destinationFileName: SP_FILE,
    mimeType: head.ContentType,
    size: head.ContentLength,
    verifyHash: true,
  });

  line('S3 stream: OK');
  line(`Folder ensure: OK (${result.sharepoint.folderCreated ? 'created' : 'exists'})`);
  line(`Upload: OK (strategy=${result.strategy})`);
  line('');
  line(`sharepoint.itemId: ${result.sharepoint.itemId}`);
  line(`sharepoint.name: ${result.sharepoint.name}`);
  line(`sharepoint.size: ${result.sharepoint.size}`);
  line(`sharepoint.webUrl: ${result.sharepoint.webUrl}`);
  line(`sharepoint.mimeType: ${result.sharepoint.mimeType}`);
  line('');

  line('--- 4) Integridad ---');
  line(`sourceHash (sha256): ${result.integrity.sourceHash}`);
  line(`destinationHash (sha256): ${result.integrity.destinationHash}`);
  line(`hashMatch: ${result.integrity.match}`);
  line(`sizeMatch: ${result.integrity.sizeMatch}`);
  if (result.integrity.note) line(`note: ${result.integrity.note}`);

  if (result.sharepoint.name !== SP_FILE) {
    throw new Error(`Nombre inesperado: ${result.sharepoint.name}`);
  }
  if (Number(result.sharepoint.size) !== Number(head.ContentLength)) {
    throw new Error(
      `Size mismatch: SP=${result.sharepoint.size} S3=${head.ContentLength}`
    );
  }
  if (result.integrity.match === true) {
    line('Metadata + SHA-256 verification: OK');
  } else if (result.integrity.sizeMatch) {
    line(
      'Metadata verification: OK (name/size). SHA-256 destino no disponible en esta corrida — limitación documentada.'
    );
  } else {
    throw new Error('Verificación de integridad falló');
  }
  line('');

  line('--- 5) Cleanup SharePoint (S3 se conserva) ---');
  await deleteItem(result.sharepoint.itemId);
  line('Delete SharePoint file: OK');

  const after = await listFolder(assertTestPath(SP_FOLDER));
  if (after.children.length === 0) {
    const folder = await getFolderByPath(SP_FOLDER);
    await deleteItem(folder.id);
    line('Delete S3_SYNC_TEST: OK');
  } else {
    line(
      `Delete S3_SYNC_TEST: SKIPPED (not empty: ${after.children.map((c) => c.name).join(', ')})`
    );
  }

  const kept = await getFolderByPath(assertTestPath(root));
  line(`TEST_ARNALD kept: YES (id=${kept.id})`);

  // Confirmar S3 intacto
  const headAfter = await s3.headObject(S3_KEY);
  line(`S3 object kept: YES (size=${headAfter.ContentLength})`);
  line('');
  line('FASE 3: PASSED');
}

main().catch((error) => {
  console.error('');
  console.error('FASE 3: FAILED');
  console.error(error.message || error);
  if (error instanceof SyncError || error.code) {
    console.error(`code: ${error.code}`);
  }
  const graphBody = error.cause?.body?.error || error.body?.error;
  if (graphBody) {
    console.error('Microsoft Graph error:');
    console.error(JSON.stringify(graphBody, null, 2));
  }
  process.exit(1);
});
