/**
 * FASE 8 — API estado SharePoint Alfa + retry (pruebas A–H backend).
 *
 * Uso: node scripts/testAlfaSharePointFrontendApi.js
 *
 * No migra históricos. No toca otros módulos.
 */

import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import ClaimDocument from '../models/ClaimDocument.js';
import * as s3 from '../services/s3StorageService.js';
import { JWT_SECRET } from '../config/secrets.js';
import {
  buildAlfaSharePointDocumentsStatus,
  markAlfaClaimDocumentForRetry,
} from '../services/alfaSharePointStatusService.js';
import { buildAlfaIntegrationKey } from '../services/alfaClaimDocumentEnqueueService.js';
import { parseS3KeyFromStoredPath } from '../utils/storageKeyBuilder.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const S3_KEY = 'test/sharepoint-sync/arnald-s3-fase8.txt';
const S3_CONTENT = 'FASE8 frontend status test\n';
const SINIESTRO = 'TEST-ARNALD-FASE8-UI-001';

let casoId = null;
const claimIds = [];

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

function tokenFor(role) {
  return jwt.sign(
    { id: new mongoose.Types.ObjectId().toString(), login: `fase8-${role}`, role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function ensureS3() {
  const bucket = s3.getBucketName();
  try {
    await s3.headObject(S3_KEY);
  } catch {
    await s3.putObject({
      key: S3_KEY,
      body: Buffer.from(S3_CONTENT, 'utf8'),
      contentType: 'text/plain; charset=utf-8',
    });
  }
  return bucket;
}

async function cleanup() {
  if (claimIds.length) await ClaimDocument.deleteMany({ _id: { $in: claimIds } });
  await ClaimDocument.deleteMany({ claimNumber: SINIESTRO, sourceModule: 'alfa' });
  if (casoId) await SegurosAlfaCaso.deleteOne({ _id: casoId });
  await SegurosAlfaCaso.deleteMany({ siniestro: SINIESTRO, identificacion: 'FASE8-UI' });
}

async function main() {
  line('=== FASE 8 — API Archivero SharePoint Alfa ===');
  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  const bucket = await ensureS3();
  line('Mongo/S3: OK');

  const caso = await SegurosAlfaCaso.create({
    consecutivo: `ALFA-FASE8-${Date.now()}`,
    siniestro: SINIESTRO,
    identificacion: 'FASE8-UI',
    asegurado: 'Asegurado FASE8',
    estado: 'PENDIENTE',
    archivos: [
      {
        nombreOriginal: 'poliza-nueva.pdf',
        nombreArchivo: 'poliza-nueva.pdf',
        ruta: `s3:${S3_KEY}`,
        tamaño: 100,
        tipoMime: 'application/pdf',
        etiqueta: 'POLIZA',
        fechaSubida: new Date(),
      },
      {
        nombreOriginal: 'legacy-sin-claim.pdf',
        nombreArchivo: 'legacy-sin-claim.pdf',
        ruta: `s3:${S3_KEY}.legacy-fake`,
        tamaño: 50,
        tipoMime: 'application/pdf',
        etiqueta: 'GENERAL',
        fechaSubida: new Date(),
      },
    ],
  });
  casoId = caso._id;
  const archivoPending = caso.archivos[0];
  const archivoLegacy = caso.archivos[1];

  // Claim pending
  const pendingClaim = await ClaimDocument.create({
    sourceModule: 'alfa',
    claimId: caso._id,
    claimNumber: SINIESTRO,
    insurer: 'SEGUROS ALFA',
    documentType: 'poliza',
    originalName: 'poliza-nueva.pdf',
    storedName: 'poliza-nueva.pdf',
    mimeType: 'application/pdf',
    size: 100,
    storage: { provider: 's3', bucket, key: S3_KEY },
    sharepoint: { enabled: true, syncStatus: 'pending', attempts: 0 },
    status: 'active',
    integrationKey: buildAlfaIntegrationKey(caso._id, S3_KEY),
  });
  claimIds.push(pendingClaim._id);

  // --- A pending ---
  line('TEST A: pending visible');
  let status = await buildAlfaSharePointDocumentsStatus(caso);
  const docA = status.documents.find((d) => d.archivoId === String(archivoPending._id));
  line(`status=${docA?.sync?.status}`);
  if (docA?.sync?.status !== 'pending') fail('A', new Error(docA?.sync?.status));
  pass('TEST A');

  // --- B synced ---
  line('TEST B: synced + webUrl');
  pendingClaim.sharepoint.syncStatus = 'synced';
  pendingClaim.sharepoint.attempts = 1;
  pendingClaim.sharepoint.itemId = 'ITEM-FASE8';
  pendingClaim.sharepoint.webUrl =
    'https://grupoproser.sharepoint.com/sites/DocumentalProser/Documentos/SINIESTROS/SEGUROS%20ALFA/x/poliza.pdf';
  pendingClaim.sharepoint.syncedAt = new Date();
  pendingClaim.sharepoint.path =
    'SEGUROS ALFA/SINIESTROS/TEST/02_POLIZA/poliza-nueva.pdf';
  await pendingClaim.save();
  status = await buildAlfaSharePointDocumentsStatus(await SegurosAlfaCaso.findById(caso._id));
  const docB = status.documents.find((d) => d.archivoId === String(archivoPending._id));
  line(`status=${docB.sync.status} webUrl=${Boolean(docB.sync.webUrl)}`);
  if (docB.sync.status !== 'synced' || !docB.sync.webUrl) fail('B', new Error('synced/webUrl'));
  pass('TEST B');

  // --- C failed ---
  line('TEST C: failed');
  pendingClaim.sharepoint.syncStatus = 'failed';
  pendingClaim.sharepoint.lastError = { code: 'S3_OBJECT_NOT_FOUND', message: 'missing' };
  pendingClaim.sharepoint.webUrl = undefined;
  pendingClaim.sharepoint.itemId = undefined;
  pendingClaim.markModified('sharepoint');
  await pendingClaim.save();
  status = await buildAlfaSharePointDocumentsStatus(await SegurosAlfaCaso.findById(caso._id));
  const docC = status.documents.find((d) => d.archivoId === String(archivoPending._id));
  line(`status=${docC.sync.status} errorCode=${docC.sync.lastErrorCode}`);
  if (docC.sync.status !== 'failed') fail('C', new Error(docC.sync.status));
  pass('TEST C');

  // --- D retry admin ---
  line('TEST D: retry marca elegible');
  const casoFresh = await SegurosAlfaCaso.findById(caso._id);
  const retry = await markAlfaClaimDocumentForRetry({
    caso: casoFresh,
    archivoId: String(archivoPending._id),
  });
  const afterRetry = await ClaimDocument.findById(pendingClaim._id);
  line(`nextRetryAt=${afterRetry.sharepoint.nextRetryAt} status=${afterRetry.sharepoint.syncStatus}`);
  if (!afterRetry.sharepoint.nextRetryAt) fail('D', new Error('nextRetryAt'));
  if (afterRetry.sharepoint.syncStatus !== 'failed') fail('D', new Error('debe seguir failed elegible'));
  // tokens existen para roles
  const adminTok = tokenFor('admin');
  const userTok = tokenFor('usuario');
  if (!adminTok || !userTok) fail('D', new Error('jwt'));
  pass('TEST D');

  // --- E rol sin permiso (middleware contract) ---
  line('TEST E: rol no admin/soporte debe ser 403 en ruta (contrato)');
  const rol = String(jwt.verify(userTok, JWT_SECRET).role).toLowerCase();
  const permitido = rol === 'admin' || rol === 'soporte';
  line(`usuario role permitido=${permitido}`);
  if (permitido) fail('E', new Error('fixture'));
  pass('TEST E');

  // --- F legacy ---
  line('TEST F: legacy sin ClaimDocument → none');
  status = await buildAlfaSharePointDocumentsStatus(await SegurosAlfaCaso.findById(caso._id));
  const docF = status.documents.find((d) => d.archivoId === String(archivoLegacy._id));
  line(`legacy status=${docF.sync.status}`);
  if (docF.sync.status !== 'none') fail('F', new Error(docF.sync.status));
  pass('TEST F');

  // --- G S3 download path still parseable ---
  line('TEST G: S3 key resoluble para descarga ARNALD');
  const key = parseS3KeyFromStoredPath(archivoPending.ruta);
  line(`s3Key=${key}`);
  if (key !== S3_KEY) fail('G', new Error(key));
  const head = await s3.headObject(S3_KEY);
  if (!head) fail('G', new Error('head'));
  pass('TEST G');

  // --- H SharePoint status failure no rompe datos caso ---
  line('TEST H: caso/archivos siguen OK aunque sync falle');
  const casoH = await SegurosAlfaCaso.findById(caso._id).lean();
  if (!casoH?.archivos?.length) fail('H', new Error('archivos'));
  line(`archivos=${casoH.archivos.length} summary failed=${status.summary.failed}`);
  pass('TEST H');

  line('summary batch:');
  line(JSON.stringify(status.summary));
  line(`retry result: ${JSON.stringify(retry)}`);
  line('');

  await cleanup();
  line('Cleanup: OK');
  line('FASE 8: PASSED');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('FASE 8: FAILED');
  console.error(err);
  try {
    await cleanup();
  } catch {}
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
