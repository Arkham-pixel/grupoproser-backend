/**
 * Prueba: Alfa sin siniestro → claimNumber = consecutivo → SharePoint sync.
 *
 * Uso: node scripts/testAlfaClaimNumberConsecutivo.js
 */

import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import ClaimDocument from '../models/ClaimDocument.js';
import * as s3 from '../services/s3StorageService.js';
import { getAccessToken, deleteItem, getFolderByPath } from '../services/microsoftGraphService.js';
import { buildAlfaSharePointPath } from '../utils/alfaSharePointPath.js';
import {
  enqueueAlfaClaimDocumentAfterUpload,
  resolveAlfaClaimNumber,
  buildAlfaIntegrationKey,
} from '../services/alfaClaimDocumentEnqueueService.js';
import { syncClaimDocument } from '../services/claimDocumentSyncService.js';
import { buildAlfaSharePointDocumentsStatus } from '../services/alfaSharePointStatusService.js';
import { sanitizeStoredFileName } from '../utils/sharepointClaimPath.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const S3_KEY = 'test/sharepoint-sync/arnald-s3-consecutivo.txt';
const S3_CONTENT = 'FASE Alfa claimNumber=consecutivo\n';
const CONSECUTIVO = `ALFA-2026-08-${Date.now().toString().slice(-4)}`;
const PILOT_FOLDER = `SEGUROS ALFA/SINIESTROS/PENDIENTES_NUMERO_SINIESTRO/${CONSECUTIVO}`;

let casoId = null;
let docId = null;

function line(msg) {
  console.log(msg);
}

function pass(n) {
  line(`${n}: PASSED`);
  line('');
}

function fail(n, e) {
  throw new Error(`${n}: ${e?.message || e}`);
}

async function cleanup() {
  if (docId) await ClaimDocument.deleteMany({ _id: docId });
  await ClaimDocument.deleteMany({ claimNumber: CONSECUTIVO, sourceModule: 'alfa' });
  if (casoId) await SegurosAlfaCaso.deleteOne({ _id: casoId });
  await SegurosAlfaCaso.deleteMany({ consecutivo: CONSECUTIVO, identificacion: 'FASE-CONSEC' });
  try {
    const folder = await getFolderByPath(PILOT_FOLDER);
    if (folder?.id) await deleteItem(folder.id);
  } catch {
    // ok
  }
}

async function main() {
  process.env.SHAREPOINT_SYNC_MODE = 'pilot';
  process.env.SHAREPOINT_SYNC_ALFA_ENABLED = 'true';
  process.env.SHAREPOINT_SYNC_ENABLED_MODULES = 'alfa';
  process.env.SHAREPOINT_SYNC_FORCE_TEST_ROOT = 'false';

  line('=== Alfa claimNumber = consecutivo (sin siniestro) ===');

  const r1 = resolveAlfaClaimNumber({ siniestro: '123', consecutivo: 'ALFA-X' });
  if (r1.claimNumber !== '123' || r1.claimNumberSource !== 'siniestro') {
    fail('RESOLVE', new Error(JSON.stringify(r1)));
  }
  const r2 = resolveAlfaClaimNumber({ siniestro: '  ', consecutivo: CONSECUTIVO });
  if (r2.claimNumber !== CONSECUTIVO || r2.claimNumberSource !== 'consecutivo') {
    fail('RESOLVE', new Error(JSON.stringify(r2)));
  }
  const r3 = resolveAlfaClaimNumber({ siniestro: '', consecutivo: '' });
  if (r3 !== null) fail('RESOLVE', new Error('expected null'));

  const pathProv = buildAlfaSharePointPath({
    claimNumber: CONSECUTIVO,
    documentType: 'poliza',
    claimNumberSource: 'consecutivo',
  });
  const pathDef = buildAlfaSharePointPath({
    claimNumber: '123456789',
    documentType: 'poliza',
    claimNumberSource: 'siniestro',
  });
  line(`ruta provisional calculada: ${pathProv}`);
  line(`ruta definitiva calculada: ${pathDef}`);
  if (pathProv !== `SEGUROS ALFA/SINIESTROS/PENDIENTES_NUMERO_SINIESTRO/${CONSECUTIVO}/02_POLIZA`) {
    fail('PATH', new Error(pathProv));
  }
  if (pathDef !== 'SEGUROS ALFA/SINIESTROS/123456789/02_POLIZA') {
    fail('PATH', new Error(pathDef));
  }
  pass('resolveAlfaClaimNumber + path builder');

  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
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
  await getAccessToken();
  line('Mongo/S3/SharePoint: OK');
  line(`consecutivo=${CONSECUTIVO}`);
  line('');

  const caso = await SegurosAlfaCaso.create({
    consecutivo: CONSECUTIVO,
    siniestro: '', // vacío a propósito
    identificacion: 'FASE-CONSEC',
    asegurado: 'Prueba consecutivo',
    estado: 'PENDIENTE',
    archivos: [],
  });
  casoId = caso._id;

  const req = {
    file: {
      originalname: 'Manual-del-Usuario.pdf',
      mimetype: 'application/pdf',
      size: Buffer.byteLength(S3_CONTENT),
    },
    fileStorage: {
      driver: 's3',
      s3Key: S3_KEY,
      filename: sanitizeStoredFileName('Manual-del-Usuario.pdf'),
      publicPath: `s3:${S3_KEY}`,
      size: Buffer.byteLength(S3_CONTENT),
      mimetype: 'application/pdf',
    },
    usuario: { id: new mongoose.Types.ObjectId().toString(), login: 'test', nombre: 'Test' },
  };

  caso.archivos.push({
    nombreOriginal: 'Manual-del-Usuario.pdf',
    nombreArchivo: req.fileStorage.filename,
    ruta: req.fileStorage.publicPath,
    tamaño: req.fileStorage.size,
    tipoMime: 'application/pdf',
    etiqueta: 'POLIZA',
    fechaSubida: new Date(),
  });
  await caso.save();

  const enq = await enqueueAlfaClaimDocumentAfterUpload({
    caso,
    archivo: caso.archivos[caso.archivos.length - 1],
    req,
    etiqueta: 'POLIZA',
  });
  docId = enq.document?._id;
  line(`enqueue=${enq.result}`);
  line(`claimNumber=${enq.document?.claimNumber}`);
  line(`claimNumberSource=${enq.document?.claimNumberSource}`);
  line(`syncStatus=${enq.document?.sharepoint?.syncStatus}`);

  if (enq.result !== 'ENQUEUED') fail('ENQUEUE', new Error(enq.result));
  if (enq.document.claimNumber !== CONSECUTIVO) fail('ENQUEUE', new Error('claimNumber'));
  if (enq.document.claimNumberSource !== 'consecutivo') fail('ENQUEUE', new Error('source'));
  if (enq.document.sharepoint.syncStatus !== 'pending') fail('ENQUEUE', new Error('pending'));
  pass('ClaimDocument pending con consecutivo');

  // UI status batch
  const ui = await buildAlfaSharePointDocumentsStatus(await SegurosAlfaCaso.findById(caso._id));
  const row = ui.documents.find(
    (d) => d.archivoId === String(caso.archivos[caso.archivos.length - 1]._id)
  );
  line(`UI sync status=${row?.sync?.status}`);
  if (row?.sync?.status !== 'pending') fail('UI', new Error(row?.sync?.status));
  pass('UI muestra Pendiente (no "No sincronizado")');

  const sync = await syncClaimDocument(docId);
  const after = await ClaimDocument.findById(docId);
  line(`worker=${sync.result}`);
  line(`path=${after.sharepoint.path}`);
  line(`webUrl=${after.sharepoint.webUrl}`);
  if (sync.result !== 'synced') fail('SYNC', new Error(sync.result));
  if (!String(after.sharepoint.path || '').startsWith(PILOT_FOLDER)) {
    fail('SYNC', new Error(`path esperado bajo ${PILOT_FOLDER}`));
  }
  if (after.claimNumberSource !== 'consecutivo') fail('SYNC', new Error('source lost'));
  pass('Worker synced + carpeta SharePoint con consecutivo');

  const ui2 = await buildAlfaSharePointDocumentsStatus(await SegurosAlfaCaso.findById(caso._id));
  const row2 = ui2.documents.find(
    (d) => d.archivoId === String(caso.archivos[caso.archivos.length - 1]._id)
  );
  line(`UI after sync=${row2?.sync?.status}`);
  if (row2?.sync?.status !== 'synced') fail('UI2', new Error(row2?.sync?.status));
  pass('UI pending → synced');

  // idempotencia
  const dup = await enqueueAlfaClaimDocumentAfterUpload({
    caso,
    archivo: caso.archivos[caso.archivos.length - 1],
    req,
    etiqueta: 'POLIZA',
  });
  const count = await ClaimDocument.countDocuments({
    integrationKey: buildAlfaIntegrationKey(caso._id, S3_KEY),
  });
  if (dup.result !== 'DUPLICATE' || count !== 1) fail('IDEM', new Error(dup.result));
  pass('Idempotencia');

  await cleanup();
  line('Cleanup: OK');
  line('POLITICA CONSECUTIVO: PASSED');
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('FAILED', e);
  try {
    await cleanup();
  } catch {}
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
