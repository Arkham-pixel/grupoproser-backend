/**
 * FASE 2 — Prueba aislada de escritura SharePoint bajo TEST_ARNALD.
 *
 * Uso: node scripts/testSharePointWrite.js
 *
 * NO toca PÓLIZAS / CONTROL Y SEGUIMIENTO / SINIESTROS.
 * NO toca S3, Mongo, frontend ni módulos de negocio.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../config/loadEnv.js';
import {
  getAccessToken,
  resolveDriveContext,
  ensureFolder,
  listFolder,
  uploadSmallFile,
  getItemMetadata,
  deleteItem,
  getFolderByPath,
} from '../services/microsoftGraphService.js';
import { getSharePointConfig } from '../config/sharepoint.js';
import { assertTestPath, getSharePointTestRoot } from '../utils/sharepointTestPath.js';

const FILE_NAME = 'arnald-sharepoint-test.txt';
const FILE_CONTENT = 'Prueba de integración ARNALD - Microsoft SharePoint\n';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

function getTestRoot() {
  return getSharePointTestRoot();
}

function line(msg) {
  console.log(msg);
}

function countEnvKeyOccurrences(filePath, key) {
  if (!fs.existsSync(filePath)) return 0;
  const text = fs.readFileSync(filePath, 'utf8');
  const re = new RegExp(`^\\s*${key}\\s*=`, 'gm');
  return (text.match(re) || []).length;
}

function validateEnv() {
  const cfg = getSharePointConfig();
  const rootCount = countEnvKeyOccurrences(ENV_PATH, 'MS_SHAREPOINT_ROOT_TEST');
  const driveCount = countEnvKeyOccurrences(ENV_PATH, 'MS_SHAREPOINT_DRIVE_ID');

  line('--- Env check ---');
  line(`MS_SHAREPOINT_ROOT_TEST occurrences in .env: ${rootCount}`);
  line(`MS_SHAREPOINT_ROOT_TEST value: ${cfg.testRootFolder}`);
  line(`MS_SHAREPOINT_DRIVE_ID occurrences in .env: ${driveCount}`);
  line(
    `MS_SHAREPOINT_DRIVE_ID configured: ${cfg.driveId ? 'YES' : 'NO'} (${
      cfg.driveId ? `${cfg.driveId.slice(0, 8)}…` : 'missing'
    })`
  );
  line(`MS_SHAREPOINT_SITE_ID configured: ${cfg.siteId ? 'YES' : 'NO'}`);
  line('');

  if (rootCount !== 1) {
    throw new Error(
      `MS_SHAREPOINT_ROOT_TEST debe aparecer exactamente 1 vez en .env (encontradas: ${rootCount})`
    );
  }
  if (!cfg.driveId) {
    throw new Error('MS_SHAREPOINT_DRIVE_ID no está configurado');
  }
  if (driveCount < 1) {
    throw new Error('MS_SHAREPOINT_DRIVE_ID no aparece en .env');
  }
}

async function main() {
  validateEnv();

  const root = getTestRoot();
  const trialFolder = `${root}/PRUEBA_ESCRITURA`;

  assertTestPath(root);
  assertTestPath(trialFolder);
  assertTestPath(`${trialFolder}/${FILE_NAME}`);

  line('--- 1) Conexión ---');
  await getAccessToken();
  line('Token: OK');
  const ctx = await resolveDriveContext();
  line('SharePoint connection: OK');
  line(`siteId: ${ctx.siteId}`);
  line(`driveId: ${ctx.driveId}`);
  line(`driveName: ${ctx.drive?.name || '(n/a)'}`);
  line('');

  line('--- 2) ensureFolder TEST_ARNALD ---');
  const rootFolder = await ensureFolder(assertTestPath(root));
  line(`TEST_ARNALD: ${rootFolder.created ? 'created' : 'exists'}`);
  line(`itemId: ${rootFolder.item?.id}`);
  line('');

  line('--- 3) ensureFolder PRUEBA_ESCRITURA ---');
  const trial = await ensureFolder(assertTestPath(trialFolder));
  line(`PRUEBA_ESCRITURA: ${trial.created ? 'created' : 'exists'}`);
  line(`itemId: ${trial.item?.id}`);
  line('');

  line('--- 4/5) uploadSmallFile ---');
  const uploaded = await uploadSmallFile(
    assertTestPath(trialFolder),
    FILE_NAME,
    Buffer.from(FILE_CONTENT, 'utf8'),
    { contentType: 'text/plain; charset=utf-8', conflictBehavior: 'replace' }
  );
  line('File upload: OK');
  line(`uploaded.id: ${uploaded.id}`);
  line(`uploaded.name: ${uploaded.name}`);
  line(`uploaded.size: ${uploaded.size}`);
  line('');

  line('--- 6) getItemMetadata ---');
  const meta = await getItemMetadata(uploaded.id);
  line(`name: ${meta.name}`);
  line(`itemId: ${meta.id}`);
  line(`size: ${meta.size}`);
  line(`webUrl: ${meta.webUrl}`);
  line(
    `parentReference: ${JSON.stringify({
      driveId: meta.parentReference?.driveId,
      id: meta.parentReference?.id,
      path: meta.parentReference?.path,
    })}`
  );
  line(`createdDateTime: ${meta.createdDateTime}`);
  line(`lastModifiedDateTime: ${meta.lastModifiedDateTime}`);
  line('');

  line('--- 7) listFolder ---');
  const listed = await listFolder(assertTestPath(trialFolder));
  const found = listed.children.some(
    (c) => c.id === meta.id || c.name === FILE_NAME || c.name === meta.name
  );
  line('List folder: OK');
  line(`children: ${listed.children.map((c) => c.name).join(', ') || '(vacío)'}`);
  line(`File found: ${found}`);
  line('');

  if (!found) {
    throw new Error('El archivo subido no aparece en el listado de PRUEBA_ESCRITURA');
  }

  const parentPath = String(meta.parentReference?.path || '');
  if (!parentPath.includes(root)) {
    throw new Error(`Abort delete: parent path fuera de ${root}: ${parentPath}`);
  }

  line('--- 8) delete file ---');
  await deleteItem(meta.id);
  line('Delete file: OK');
  line('');

  line('--- 9) delete PRUEBA_ESCRITURA si vacía ---');
  const after = await listFolder(assertTestPath(trialFolder));
  if (after.children.length === 0) {
    assertTestPath(trialFolder);
    const folderMeta = await getFolderByPath(trialFolder);
    await deleteItem(folderMeta.id);
    line('Delete PRUEBA_ESCRITURA: OK');
  } else {
    line(
      `Delete PRUEBA_ESCRITURA: SKIPPED (folder not empty: ${after.children
        .map((c) => c.name)
        .join(', ')})`
    );
  }

  line('--- 10) verificar TEST_ARNALD permanece ---');
  const kept = await getFolderByPath(assertTestPath(root));
  line(`TEST_ARNALD kept: YES (id=${kept.id})`);
  line('');
  line('FASE 2: PASSED');
}

main().catch((error) => {
  console.error('');
  console.error('FASE 2: FAILED');
  console.error(error.message || error);
  if (error.code) console.error(`code: ${error.code}`);
  if (error.status) console.error(`status: ${error.status}`);
  if (error.body?.error) {
    console.error('Microsoft Graph error:');
    console.error(JSON.stringify(error.body.error, null, 2));
  } else if (error.cause?.body?.error) {
    console.error('Microsoft Graph error:');
    console.error(JSON.stringify(error.cause.body.error, null, 2));
  }
  process.exit(1);
});
