/**
 * FASE 6 — Piloto Seguros Alfa → ClaimDocument → SharePoint (SINIESTROS).
 *
 * Uso:
 *   node scripts/testAlfaSharePointPilot.js
 *
 * Para H (worker + SharePoint real) el script pone temporalmente:
 *   SHAREPOINT_SYNC_MODE=pilot
 *   SHAREPOINT_SYNC_ALFA_ENABLED=true
 * sin persistir en .env.
 *
 * Cron permanece apagado. No toca frontend ni otros módulos.
 */

import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import ClaimDocument from '../models/ClaimDocument.js';
import * as s3 from '../services/s3StorageService.js';
import {
  getAccessToken,
  deleteItem,
  getFolderByPath,
} from '../services/microsoftGraphService.js';
import { mapAlfaDocumentType } from '../config/alfaClaimDocumentMap.js';
import { assertAllowedSharePointPath } from '../utils/sharepointPathGuard.js';
import { assertTestPath } from '../utils/sharepointTestPath.js';
import {
  enqueueAlfaClaimDocumentAfterUpload,
  buildAlfaIntegrationKey,
} from '../services/alfaClaimDocumentEnqueueService.js';
import { syncClaimDocument } from '../services/claimDocumentSyncService.js';
import { sanitizeStoredFileName } from '../utils/sharepointClaimPath.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const S3_KEY = 'test/sharepoint-sync/arnald-s3-test.txt';
const S3_CONTENT = 'Prueba ARNALD S3 → Microsoft SharePoint\n';
const PILOT_SINIESTRO = 'TEST-ARNALD-FASE6-001';
const PILOT_FOLDER = `SEGUROS ALFA/SINIESTROS/${PILOT_SINIESTRO}`;

const createdClaimIds = [];
let pilotCasoId = null;
let pilotDocumentId = null;

function line(msg) {
  console.log(msg);
}

function pass(name) {
  line(`${name}: PASSED`);
  line('');
}

function fail(name, err) {
  throw new Error(`${name}: ${err.message || err}`);
}

function setEnv(key, value) {
  process.env[key] = value;
}

function mockReq({ s3Key, userId = new mongoose.Types.ObjectId().toString() } = {}) {
  return {
    file: {
      originalname: 'poliza-prueba.pdf',
      mimetype: 'application/pdf',
      size: 1234,
    },
    fileStorage: {
      driver: 's3',
      s3Key,
      filename: sanitizeStoredFileName('poliza-prueba.pdf'),
      publicPath: `s3:${s3Key}`,
      size: 1234,
      mimetype: 'application/pdf',
    },
    usuario: {
      id: userId,
      login: 'fase6-test',
      nombre: 'FASE6 Test',
    },
  };
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
    });
  }
  return bucket;
}

async function cleanupSharePointPilot() {
  try {
    const folder = await getFolderByPath(PILOT_FOLDER);
    if (folder?.id) {
      await deleteItem(folder.id);
      return 1;
    }
  } catch {
    return 0;
  }
  return 0;
}

async function cleanupMongo() {
  let n = 0;
  if (createdClaimIds.length) {
    const r = await ClaimDocument.deleteMany({ _id: { $in: createdClaimIds } });
    n += r.deletedCount || 0;
  }
  if (pilotDocumentId) {
    await ClaimDocument.deleteMany({ _id: pilotDocumentId });
  }
  await ClaimDocument.deleteMany({
    sourceModule: 'alfa',
    claimNumber: PILOT_SINIESTRO,
  });
  if (pilotCasoId) {
    await SegurosAlfaCaso.deleteOne({ _id: pilotCasoId });
  }
  await SegurosAlfaCaso.deleteMany({ siniestro: PILOT_SINIESTRO, identificacion: 'FASE6-TEST' });
  return n;
}

async function main() {
  line('=== FASE 6 — Piloto Seguros Alfa ===');
  line('');

  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI no definido');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  line('Mongo connection: OK');

  const bucket = await ensureS3();
  line('S3 connection: OK');

  await getAccessToken();
  line('SharePoint connection: OK');
  line('');

  // Mapping unit
  const mapPoliza = mapAlfaDocumentType('POLIZA');
  const mapUnknown = mapAlfaDocumentType('XYZ_RARO');
  if (mapPoliza.documentType !== 'poliza' || mapPoliza.fallback) {
    fail('MAP', new Error('POLIZA mapping'));
  }
  if (mapUnknown.documentType !== 'soporte' || !mapUnknown.fallback) {
    fail('MAP', new Error('fallback mapping'));
  }
  line('Mapping: POLIZA→poliza, unknown→soporte+fallback OK');
  line('');

  // ---------- A: flag OFF ----------
  line('TEST A: flag OFF');
  setEnv('SHAREPOINT_SYNC_ALFA_ENABLED', 'false');
  setEnv('SHAREPOINT_SYNC_MODE', 'test');
  const casoA = {
    _id: new mongoose.Types.ObjectId(),
    siniestro: PILOT_SINIESTRO,
  };
  const rA = await enqueueAlfaClaimDocumentAfterUpload({
    caso: casoA,
    archivo: { nombreOriginal: 'a.pdf', etiqueta: 'POLIZA', ruta: `s3:${S3_KEY}` },
    req: mockReq({ s3Key: S3_KEY }),
    etiqueta: 'POLIZA',
  });
  const countA = await ClaimDocument.countDocuments({
    integrationKey: buildAlfaIntegrationKey(casoA._id, S3_KEY),
  });
  line(`result=${rA.result} claimDocs=${countA}`);
  if (rA.result !== 'DISABLED' || countA !== 0) fail('TEST A', new Error('debió DISABLED'));
  pass('TEST A');

  // ---------- B: flag ON pero mode test + enqueue OK pendiente (legacy upload no tocado) ----------
  line('TEST B: flag ON (enqueue service) sin romper contrato');
  setEnv('SHAREPOINT_SYNC_ALFA_ENABLED', 'true');
  setEnv('SHAREPOINT_SYNC_MODE', 'test');
  // En mode test aún se encola pending; path SINIESTROS se valida en worker/pilot
  const casoB = {
    _id: new mongoose.Types.ObjectId(),
    siniestro: PILOT_SINIESTRO,
  };
  const rB = await enqueueAlfaClaimDocumentAfterUpload({
    caso: casoB,
    archivo: {
      nombreOriginal: 'b.pdf',
      nombreArchivo: 'b.pdf',
      etiqueta: 'POLIZA',
      tamaño: 100,
      tipoMime: 'application/pdf',
      ruta: `s3:${S3_KEY}`,
      subidoPor: { login: 't', nombre: 't' },
    },
    req: mockReq({ s3Key: `${S3_KEY}.b` }),
    etiqueta: 'POLIZA',
  });
  if (rB.document?._id) createdClaimIds.push(rB.document._id);
  line(`result=${rB.result}`);
  if (rB.result !== 'ENQUEUED') fail('TEST B', new Error(rB.result));
  pass('TEST B');

  // ---------- C: caso inexistente (no enqueue) ----------
  line('TEST C: caso inexistente → no ClaimDocument');
  const rC = await enqueueAlfaClaimDocumentAfterUpload({
    caso: null,
    archivo: {},
    req: mockReq({ s3Key: S3_KEY }),
    etiqueta: 'POLIZA',
  });
  line(`result=${rC.result}`);
  if (rC.result !== 'MISSING_CASE') fail('TEST C', new Error(rC.result));
  line('Nota: Multer puede dejar S3 huérfano en 404 real; sin GC en esta fase.');
  pass('TEST C');

  // ---------- D: sin siniestro pero con consecutivo → encola ----------
  line('TEST D: siniestro vacío → claimNumber=consecutivo');
  setEnv('SHAREPOINT_SYNC_ALFA_ENABLED', 'true');
  const consecD = 'ALFA-TEST-D-CONSEC';
  const rD = await enqueueAlfaClaimDocumentAfterUpload({
    caso: {
      _id: new mongoose.Types.ObjectId(),
      siniestro: '   ',
      consecutivo: consecD,
    },
    archivo: {
      nombreOriginal: 'd.pdf',
      nombreArchivo: 'd.pdf',
      tamaño: 10,
      tipoMime: 'application/pdf',
      ruta: `s3:${S3_KEY}.d`,
    },
    req: mockReq({ s3Key: `${S3_KEY}.d` }),
    etiqueta: 'POLIZA',
  });
  if (rD.document?._id) createdClaimIds.push(rD.document._id);
  line(`result=${rD.result} claimNumber=${rD.document?.claimNumber} source=${rD.document?.claimNumberSource}`);
  if (rD.result !== 'ENQUEUED') fail('TEST D', new Error(rD.result));
  if (rD.document?.claimNumber !== consecD || rD.document?.claimNumberSource !== 'consecutivo') {
    fail('TEST D', new Error('claimNumber/source'));
  }
  pass('TEST D');

  // ---------- E: etiqueta desconocida → soporte + fallback ----------
  line('TEST E: DOCUMENT_TYPE_FALLBACK');
  const mapE = mapAlfaDocumentType('ETIQUETA_INVENTADA');
  const casoE = { _id: new mongoose.Types.ObjectId(), siniestro: PILOT_SINIESTRO };
  const rE = await enqueueAlfaClaimDocumentAfterUpload({
    caso: casoE,
    archivo: {
      nombreOriginal: 'e.pdf',
      nombreArchivo: 'e.pdf',
      etiqueta: 'ETIQUETA_INVENTADA',
      tamaño: 10,
      tipoMime: 'application/pdf',
      ruta: `s3:${S3_KEY}`,
    },
    req: mockReq({ s3Key: `${S3_KEY}.e` }),
    etiqueta: 'ETIQUETA_INVENTADA',
  });
  if (rE.document?._id) createdClaimIds.push(rE.document._id);
  line(`map=${mapE.documentType} fallback=${mapE.fallback} docType=${rE.document?.documentType}`);
  if (!mapE.fallback || rE.document?.documentType !== 'soporte') {
    fail('TEST E', new Error('fallback'));
  }
  pass('TEST E');

  // ---------- F + G: upload válido + duplicado ----------
  line('TEST F: ClaimDocument pending');
  setEnv('SHAREPOINT_SYNC_MODE', 'pilot');
  setEnv('SHAREPOINT_SYNC_ALFA_ENABLED', 'true');
  setEnv('SHAREPOINT_SYNC_FORCE_TEST_ROOT', 'false');

  const casoF = await SegurosAlfaCaso.create({
    consecutivo: `ALFA-FASE6-${Date.now()}`,
    siniestro: PILOT_SINIESTRO,
    identificacion: 'FASE6-TEST',
    asegurado: 'Asegurado Prueba FASE6',
    estado: 'PENDIENTE',
    numeroPoliza: 'POL-FASE6',
    archivos: [],
  });
  pilotCasoId = casoF._id;

  const reqF = mockReq({ s3Key: S3_KEY });
  const archivoF = {
    nombreOriginal: 'poliza-prueba.pdf',
    nombreArchivo: reqF.fileStorage.filename,
    ruta: reqF.fileStorage.publicPath,
    tamaño: reqF.fileStorage.size,
    tipoMime: reqF.fileStorage.mimetype,
    etiqueta: 'POLIZA',
    subidoPor: { id: reqF.usuario.id, login: 'fase6-test', nombre: 'FASE6 Test' },
    fechaSubida: new Date(),
  };
  casoF.archivos.push(archivoF);
  await casoF.save();

  const rF = await enqueueAlfaClaimDocumentAfterUpload({
    caso: casoF,
    archivo: casoF.archivos[casoF.archivos.length - 1],
    req: reqF,
    etiqueta: 'POLIZA',
  });
  pilotDocumentId = rF.document?._id;
  if (pilotDocumentId) createdClaimIds.push(pilotDocumentId);
  line(`result=${rF.result}`);
  line(`documentId=${pilotDocumentId}`);
  line(`syncStatus=${rF.document?.sharepoint?.syncStatus}`);
  line(`integrationKey=${rF.document?.integrationKey}`);
  if (rF.result !== 'ENQUEUED' || rF.document?.sharepoint?.syncStatus !== 'pending') {
    fail('TEST F', new Error(JSON.stringify({ result: rF.result, status: rF.document?.sharepoint })));
  }
  if (rF.document?.claimNumber !== PILOT_SINIESTRO || rF.document?.insurer !== 'SEGUROS ALFA') {
    fail('TEST F', new Error('claimNumber/insurer'));
  }
  if (rF.document?.documentType !== 'poliza') fail('TEST F', new Error('documentType'));
  pass('TEST F');

  line('TEST G: duplicado integrationKey');
  const rG = await enqueueAlfaClaimDocumentAfterUpload({
    caso: casoF,
    archivo: casoF.archivos[casoF.archivos.length - 1],
    req: reqF,
    etiqueta: 'POLIZA',
  });
  const countG = await ClaimDocument.countDocuments({
    integrationKey: buildAlfaIntegrationKey(casoF._id, S3_KEY),
  });
  line(`result=${rG.result} count=${countG}`);
  if (rG.result !== 'DUPLICATE' || countG !== 1) fail('TEST G', new Error('duplicado'));
  pass('TEST G');

  // ---------- I: path guard (antes del worker) ----------
  line('TEST I: path guard');
  setEnv('SHAREPOINT_SYNC_MODE', 'pilot');
  setEnv('SHAREPOINT_SYNC_ALFA_ENABLED', 'true');
  try {
    assertAllowedSharePointPath({
      path: 'PÓLIZAS/algo',
      sourceModule: 'alfa',
      mode: 'pilot',
    });
    fail('TEST I', new Error('debió bloquear PÓLIZAS'));
  } catch (e) {
    if (e.code !== 'INVALID_SHAREPOINT_PATH' && e.code !== 'INVALID_TEST_PATH') {
      fail('TEST I', e);
    }
    line(`blocked PÓLIZAS: ${e.code}`);
  }
  try {
    assertAllowedSharePointPath({
      path: 'SINIESTROS/SEGUROS ALFA/X/02_POLIZA',
      sourceModule: 'alfa',
      mode: 'pilot',
    });
    fail('TEST I', new Error('debió bloquear raíz global SINIESTROS para Alfa'));
  } catch (e) {
    line(`blocked Alfa→SINIESTROS/: ${e.code}`);
  }
  try {
    assertAllowedSharePointPath({
      path: 'SEGUROS ALFA/SINIESTROS/X/02_POLIZA',
      sourceModule: 'complex',
      mode: 'pilot',
    });
    fail('TEST I', new Error('debió bloquear complex en SEGUROS ALFA'));
  } catch (e) {
    line(`blocked complex→SEGUROS ALFA: ${e.code}`);
  }
  setEnv('SHAREPOINT_SYNC_ALFA_ENABLED', 'false');
  try {
    assertAllowedSharePointPath({
      path: 'SEGUROS ALFA/SINIESTROS/X/02_POLIZA',
      sourceModule: 'alfa',
      mode: 'pilot',
    });
    fail('TEST I', new Error('debió bloquear alfa con flag off'));
  } catch (e) {
    line(`blocked alfa flag off: ${e.code}`);
  }
  setEnv('SHAREPOINT_SYNC_ALFA_ENABLED', 'true');
  const okPath = assertAllowedSharePointPath({
    path: `${PILOT_FOLDER}/02_POLIZA`,
    sourceModule: 'alfa',
    mode: 'pilot',
  });
  line(`allowed: ${okPath}`);
  assertTestPath('TEST_ARNALD/safe');
  line('assertTestPath sigue activo');
  pass('TEST I');

  // ---------- H: worker manual ----------
  line('TEST H: worker manual → synced');
  setEnv('SHAREPOINT_SYNC_MODE', 'pilot');
  setEnv('SHAREPOINT_SYNC_ALFA_ENABLED', 'true');
  setEnv('SHAREPOINT_SYNC_FORCE_TEST_ROOT', 'false');
  setEnv('SHAREPOINT_SYNC_CRON_ENABLED', 'false');

  const rH = await syncClaimDocument(pilotDocumentId);
  const afterH = await ClaimDocument.findById(pilotDocumentId);
  line(`result=${rH.result}`);
  line(`status=${afterH.sharepoint.syncStatus}`);
  line(`attempts=${afterH.sharepoint.attempts}`);
  line(`path=${afterH.sharepoint.path}`);
  line(`itemId=${afterH.sharepoint.itemId}`);
  line(`webUrl=${afterH.sharepoint.webUrl}`);
  if (rH.result !== 'synced' || afterH.sharepoint.syncStatus !== 'synced') {
    fail('TEST H', new Error(`sync failed: ${rH.result} / ${afterH.sharepoint?.lastError?.code}`));
  }
  if (afterH.sharepoint.attempts !== 1) fail('TEST H', new Error('attempts'));
  if (!String(afterH.sharepoint.path || '').startsWith(PILOT_FOLDER)) {
    fail('TEST H', new Error(`path no bajo ${PILOT_FOLDER}`));
  }
  pass('TEST H');

  // ---------- J: rollback flag ----------
  line('TEST J: rollback flag OFF');
  setEnv('SHAREPOINT_SYNC_ALFA_ENABLED', 'false');
  const rJ = await enqueueAlfaClaimDocumentAfterUpload({
    caso: { _id: new mongoose.Types.ObjectId(), siniestro: PILOT_SINIESTRO },
    archivo: { nombreOriginal: 'j.pdf', ruta: `s3:${S3_KEY}.j` },
    req: mockReq({ s3Key: `${S3_KEY}.j` }),
    etiqueta: 'POLIZA',
  });
  line(`result=${rJ.result}`);
  if (rJ.result !== 'DISABLED') fail('TEST J', new Error(rJ.result));
  pass('TEST J');

  line('--- Ejemplo ClaimDocument piloto ---');
  line(
    JSON.stringify(
      {
        _id: afterH._id,
        sourceModule: afterH.sourceModule,
        claimId: afterH.claimId,
        claimNumber: afterH.claimNumber,
        insurer: afterH.insurer,
        documentType: afterH.documentType,
        storage: afterH.storage,
        integrationKey: afterH.integrationKey,
        sharepoint: {
          syncStatus: afterH.sharepoint.syncStatus,
          attempts: afterH.sharepoint.attempts,
          path: afterH.sharepoint.path,
          itemId: afterH.sharepoint.itemId,
          webUrl: afterH.sharepoint.webUrl,
        },
      },
      null,
      2
    )
  );
  line('');

  line('--- Cleanup ---');
  const spDel = await cleanupSharePointPilot();
  await cleanupMongo();
  line(`SharePoint pilot folder deleted: ${spDel}`);
  line('Cleanup: OK');
  line('');
  line('FASE 6: PASSED');
  line('Cron: sigue OFF (SHAREPOINT_SYNC_CRON_ENABLED no activado)');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('FASE 6: FAILED');
  console.error(err);
  try {
    await cleanupSharePointPilot();
    await cleanupMongo();
  } catch (e) {
    console.error('Cleanup parcial:', e.message);
  }
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
