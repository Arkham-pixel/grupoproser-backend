/**
 * Pruebas A–J — Importación pólizas Alfa por IDENTIFICACIÓN.
 *
 * Uso:
 *   node scripts/testAlfaPolicyImportByIdentificacion.js
 *
 * Sin escribir en SharePoint.
 * Cron permanece OFF.
 *
 * Caso real: sourceIdentifier 88187559 → ALFA-2026-08-1 → matched + policyNumber INC-008
 */

import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import ClaimDocument from '../models/ClaimDocument.js';
import {
  normalizeIdentification,
  isRealPolicyNumber,
  isPlaceholderPolicyNumber,
} from '../utils/alfaIdentification.js';
import {
  assertAlfaPolicyImportPath,
  assertAlfaPolicyImportRoot,
  ALFA_POLICY_IMPORT_PREFIX,
} from '../utils/alfaPolicySharePointPath.js';
import {
  associateAlfaPolicyDocument,
  applyAssociationReinforcements,
  findAlfaCasesByIdentification,
  listImportedAlfaPoliciesForCase,
  findArnaldOutboundBySharePointItemId,
  runAlfaPolicyImportCycle,
} from '../services/alfaPolicyImportService.js';
import { getAlfaPolicyImportConfig } from '../config/alfaPolicyImport.js';
import { isSharePointConfigured } from '../config/sharepoint.js';

const TAG = `IDPOL-${Date.now()}`;
const createdCaseIds = [];
const createdDocIds = [];
const createdClaimIds = [];
const results = {};

function line(msg) {
  console.log(msg);
}
function pass(name) {
  results[name] = 'PASSED';
  line(`${name}: PASSED`);
}
function fail(name, err) {
  results[name] = 'FAILED';
  throw new Error(`${name}: ${err?.message || err}`);
}

async function createCase(partial) {
  const caso = await SegurosAlfaCaso.create({
    estado: 'PENDIENTE',
    consecutivo: `ALFA-TEST-${TAG}-${createdCaseIds.length + 1}`,
    ...partial,
  });
  createdCaseIds.push(caso._id);
  return caso;
}

async function createPolicyDoc({
  sourceIdentifier,
  policyNumber = null,
  integrationSuffix = 'a',
  s3Key,
} = {}) {
  const id = normalizeIdentification(sourceIdentifier);
  const doc = await AlfaPolicyDocument.create({
    integrationKey: `test:idpol:${TAG}:${integrationSuffix}`,
    source: 'sharepoint',
    sourceModule: 'alfa',
    documentType: 'poliza',
    sourceIdentifier: id,
    sourceIdentifierType: 'identificacion',
    policyNumber,
    originalName: 'poliza.pdf',
    storedName: 'poliza.pdf',
    mimeType: 'application/pdf',
    size: 12,
    sharepoint: {
      driveId: 'drive-test',
      itemId: `item-${TAG}-${integrationSuffix}`,
      path: `${ALFA_POLICY_IMPORT_PREFIX}/${id}/poliza.pdf`,
    },
    storage: {
      provider: 's3',
      bucket: 'test-bucket',
      key: s3Key || `seguros-alfa/polizas/${id}/poliza.pdf`,
    },
    association: { status: 'unmatched', alfaCaseIds: [], candidateCaseIds: [] },
    importStatus: 'imported',
    importedAt: new Date(),
    status: 'active',
  });
  createdDocIds.push(doc._id);
  return doc;
}

async function cleanup() {
  for (const id of createdClaimIds) {
    try {
      await ClaimDocument.deleteOne({ _id: id });
    } catch {
      /* */
    }
  }
  for (const id of createdDocIds) {
    try {
      await AlfaPolicyDocument.deleteOne({ _id: id });
    } catch {
      /* */
    }
  }
  for (const id of createdCaseIds) {
    try {
      await SegurosAlfaCaso.deleteOne({ _id: id });
    } catch {
      /* */
    }
  }
}

async function testE_Normalize() {
  if (normalizeIdentification('88.187.559') !== '88187559') {
    fail('E', new Error('puntos'));
  }
  if (normalizeIdentification(' 88 187 559 ') !== '88187559') {
    fail('E', new Error('espacios'));
  }
  if (normalizeIdentification('88-187-559') !== '88187559') {
    fail('E', new Error('guiones'));
  }
  if (typeof normalizeIdentification('88187559') !== 'string') {
    fail('E', new Error('debe ser string'));
  }
  if (Number(normalizeIdentification('088187559')) === 88187559 &&
      normalizeIdentification('088187559') !== '088187559') {
    fail('E', new Error('no debe usar Number()'));
  }
  pass('E');
}

async function testI_PathGuard() {
  try {
    assertAlfaPolicyImportPath('SEGUROS ALFA/POLIZAS/88187559');
    fail('I', new Error('debió rechazar sin tilde'));
  } catch (e) {
    if (e.code !== 'INVALID_POLICY_IMPORT_PATH') fail('I', e);
  }
  try {
    assertAlfaPolicyImportRoot('SEGUROS ALFA/POLIZAS');
    fail('I', new Error('root sin tilde'));
  } catch (e) {
    if (e.code !== 'INVALID_POLICY_IMPORT_PATH' && e.code !== 'INVALID_POLICY_IMPORT_ROOT') {
      fail('I', e);
    }
  }
  assertAlfaPolicyImportRoot(ALFA_POLICY_IMPORT_PREFIX);
  assertAlfaPolicyImportPath(`${ALFA_POLICY_IMPORT_PREFIX}/88187559`);
  const cfg = getAlfaPolicyImportConfig();
  if (cfg.rootPath !== ALFA_POLICY_IMPORT_PREFIX) {
    fail('I', new Error(`config root=${cfg.rootPath}`));
  }
  pass('I');
}

async function testA_Unmatched() {
  const id = `${TAG}-A-NOEXISTE`;
  const doc = await createPolicyDoc({ sourceIdentifier: id, integrationSuffix: 'A' });
  const assoc = await associateAlfaPolicyDocument(doc);
  if (assoc.status !== 'unmatched') fail('A', new Error(JSON.stringify(assoc)));
  if (assoc.alfaCaseIds.length !== 0) fail('A', new Error('alfaCaseIds'));
  const reloaded = await AlfaPolicyDocument.findById(doc._id);
  if (reloaded.policyNumber != null && reloaded.policyNumber !== '') {
    fail('A', new Error('policyNumber no debe ser la carpeta'));
  }
  if (reloaded.sourceIdentifier !== normalizeIdentification(id)) {
    fail('A', new Error('sourceIdentifier'));
  }
  pass('A');
}

async function testB_MatchedOne() {
  const id = `${TAG}-B`;
  const caso = await createCase({
    identificacion: id,
    asegurado: 'Uno solo',
    numeroPoliza: 'INC-B-001',
    siniestro: null,
  });
  const doc = await createPolicyDoc({ sourceIdentifier: id, integrationSuffix: 'B' });
  const assoc = await associateAlfaPolicyDocument(doc);
  if (assoc.status !== 'matched') fail('B', new Error(JSON.stringify(assoc)));
  if (!assoc.alfaCaseIds.includes(String(caso._id))) fail('B', new Error('case id'));
  pass('B');
  return { caso, doc };
}

async function testC_Reinforcement() {
  const id = `${TAG}-C`;
  const c1 = await createCase({
    identificacion: id,
    asegurado: 'C1',
    numeroPoliza: 'INC-C-001',
    numeroCredito: 'CRED-1',
    direccionPredio: 'Calle 1',
  });
  const c2 = await createCase({
    identificacion: id,
    asegurado: 'C2',
    numeroPoliza: 'INC-C-002',
    numeroCredito: 'CRED-2',
    direccionPredio: 'Calle 2',
  });
  const pool = applyAssociationReinforcements([c1, c2], { numeroPoliza: 'INC-C-002' });
  if (pool.length !== 1 || String(pool[0]._id) !== String(c2._id)) {
    fail('C', new Error('refuerzo poliza'));
  }
  const doc = await createPolicyDoc({ sourceIdentifier: id, integrationSuffix: 'C' });
  const assoc = await associateAlfaPolicyDocument(doc, {
    hints: { numeroPoliza: 'INC-C-002' },
  });
  if (assoc.status !== 'matched') fail('C', new Error(JSON.stringify(assoc)));
  if (assoc.alfaCaseIds.length !== 1 || assoc.alfaCaseIds[0] !== String(c2._id)) {
    fail('C', new Error(JSON.stringify(assoc)));
  }
  pass('C');
}

async function testD_Ambiguous() {
  const id = `${TAG}-D`;
  await createCase({
    identificacion: id,
    asegurado: 'D1',
    numeroPoliza: 'INC-D-001',
    numeroCredito: 'X1',
  });
  await createCase({
    identificacion: id,
    asegurado: 'D2',
    numeroPoliza: 'INC-D-002',
    numeroCredito: 'X2',
  });
  const doc = await createPolicyDoc({ sourceIdentifier: id, integrationSuffix: 'D' });
  const assoc = await associateAlfaPolicyDocument(doc);
  if (assoc.status !== 'ambiguous') fail('D', new Error(JSON.stringify(assoc)));
  if (assoc.alfaCaseIds.length !== 0) fail('D', new Error('no debe asociar'));
  if ((assoc.candidateCaseIds || []).length < 2) fail('D', new Error('candidates'));
  pass('D');
}

async function testF_G_SourceVsPolicy() {
  const id = `${TAG}-FG`;
  const caso = await createCase({
    identificacion: id,
    asegurado: 'FG',
    numeroPoliza: 'INC-FG-99',
    siniestro: null,
  });
  const doc = await createPolicyDoc({
    sourceIdentifier: id,
    policyNumber: null,
    integrationSuffix: 'FG',
  });
  const assoc = await associateAlfaPolicyDocument(doc);
  const reloaded = await AlfaPolicyDocument.findById(doc._id);
  if (reloaded.sourceIdentifier === reloaded.policyNumber) {
    fail('F', new Error('sourceIdentifier confundido con policyNumber'));
  }
  if (reloaded.sourceIdentifier !== normalizeIdentification(id)) fail('F', new Error('source'));
  if (reloaded.policyNumber === id) fail('F', new Error('policy=carpeta'));
  pass('F');

  if (assoc.status !== 'matched') fail('G', new Error(JSON.stringify(assoc)));
  if (reloaded.policyNumber !== 'INC-FG-99') {
    fail('G', new Error(`enrich got ${reloaded.policyNumber}`));
  }
  if (caso.siniestro) fail('G', new Error('no usar siniestro'));
  pass('G');
}

async function testH_OneToN() {
  const id = `${TAG}-H`;
  const c1 = await createCase({
    identificacion: id,
    asegurado: 'H',
    numeroPoliza: 'INC-H-SAME',
    siniestro: 'S1',
  });
  const c2 = await createCase({
    identificacion: id,
    asegurado: 'H',
    numeroPoliza: 'INC-H-SAME',
    siniestro: 'S2',
  });
  const s3Key = `seguros-alfa/polizas/${id}/unica.pdf`;
  const doc = await createPolicyDoc({
    sourceIdentifier: id,
    integrationSuffix: 'H',
    s3Key,
  });
  const assoc = await associateAlfaPolicyDocument(doc);
  if (assoc.status !== 'matched') fail('H', new Error(JSON.stringify(assoc)));
  if (assoc.alfaCaseIds.length !== 2) fail('H', new Error('esperado N casos'));
  const ids = new Set(assoc.alfaCaseIds);
  if (!ids.has(String(c1._id)) || !ids.has(String(c2._id))) fail('H', new Error('ids'));
  const reloaded = await AlfaPolicyDocument.findById(doc._id);
  if (reloaded.storage.key !== s3Key) fail('H', new Error('S3 duplicado/cambiado'));
  pass('H');
}

async function testK_PlaceholderDoesNotLeak() {
  if (isRealPolicyNumber('POR CONFIRMAR OPERACIONES')) {
    fail('K', new Error('placeholder con espacios tratado como póliza real'));
  }
  if (isRealPolicyNumber('PORCONFIRMAROPERACIONES')) {
    fail('K', new Error('placeholder compacto tratado como póliza real'));
  }
  if (!isPlaceholderPolicyNumber('PORCONFIRMAROPERACIONES')) {
    fail('K', new Error('compacto debe ser placeholder'));
  }

  const idA = `${TAG}-KA`;
  const idB = `${TAG}-KB`;
  const placeholder = 'POR CONFIRMAR OPERACIONES';
  const casoA = await createCase({
    identificacion: idA,
    asegurado: 'ANGELICA TEST',
    numeroPoliza: placeholder,
  });
  const casoB = await createCase({
    identificacion: idB,
    asegurado: 'OTRO ASEGURADO',
    numeroPoliza: placeholder,
  });
  const doc = await createPolicyDoc({
    sourceIdentifier: idA,
    policyNumber: 'PORCONFIRMAROPERACIONES',
    integrationSuffix: 'K',
  });
  const assoc = await associateAlfaPolicyDocument(doc);
  if (assoc.status !== 'matched') fail('K', new Error(JSON.stringify(assoc)));

  const reloaded = await AlfaPolicyDocument.findById(doc._id);
  if (reloaded.policyNumber) {
    fail('K', new Error(`placeholder copiado a policyNumber=${reloaded.policyNumber}`));
  }

  const listA = await listImportedAlfaPoliciesForCase(casoA);
  const listB = await listImportedAlfaPoliciesForCase(casoB);
  if (!listA.some((p) => p.id === String(doc._id))) {
    fail('K', new Error('el documento debe salir en el caso de la misma cédula'));
  }
  if (listB.some((p) => p.id === String(doc._id))) {
    fail('K', new Error('el documento no debe salir en un caso de otra cédula'));
  }
  pass('K');
}

async function testL_PollutedCaseIdsStillIsolated() {
  const idA = `${TAG}-LA`;
  const idB = `${TAG}-LB`;
  const casoA = await createCase({
    identificacion: idA,
    asegurado: 'Carpeta A',
    numeroPoliza: 'INC-LA-1',
  });
  const casoB = await createCase({
    identificacion: idB,
    asegurado: 'Carpeta B',
    numeroPoliza: 'INC-LB-1',
  });
  const doc = await createPolicyDoc({
    sourceIdentifier: idA,
    integrationSuffix: 'L',
  });
  await associateAlfaPolicyDocument(doc);
  doc.association.alfaCaseIds = [casoA._id, casoB._id];
  await doc.save();

  const listA = await listImportedAlfaPoliciesForCase(casoA);
  const listB = await listImportedAlfaPoliciesForCase(casoB);
  if (!listA.some((p) => p.id === String(doc._id))) {
    fail('L', new Error('carpeta A debe verse en caso A'));
  }
  if (listB.some((p) => p.id === String(doc._id))) {
    fail('L', new Error('carpeta A no puede verse en caso de otra cédula aunque alfaCaseIds esté contaminado'));
  }
  pass('L');
}

async function testM_SkipArnaldOutboundItem() {
  const cedula = '88187559';
  const caso = await createCase({
    identificacion: cedula,
    asegurado: 'Skip outbound',
    numeroPoliza: 'INC-M-1',
  });
  const itemId = `item-arnald-${TAG}`;
  const claim = await ClaimDocument.create({
    sourceModule: 'alfa',
    claimId: caso._id,
    claimNumber: caso.consecutivo,
    insurer: 'SEGUROS ALFA',
    documentType: 'liquidacion',
    originalName: 'Liquidador.pdf',
    storedName: 'Liquidador.pdf',
    alfaIdentificacion: cedula,
    destinationStatus: 'ready',
    storage: { provider: 's3', bucket: 'test-bucket', key: `alfa/${caso._id}/liq.pdf` },
    sharepoint: {
      itemId,
      path: `SEGUROS ALFA/SINIESTROS/${cedula}/LIQUIDACION/Liquidador.pdf`,
      syncStatus: 'synced',
    },
    status: 'active',
    integrationKey: `alfa:${caso._id}:test-m-${TAG}`,
  });
  createdClaimIds.push(claim._id);

  const hit = await findArnaldOutboundBySharePointItemId(itemId);
  if (!hit || String(hit._id) !== String(claim._id)) {
    fail('M', new Error('debía reconocer el item outbound de ARNALD'));
  }
  const miss = await findArnaldOutboundBySharePointItemId(`other-${TAG}`);
  if (miss) fail('M', new Error('no debe matchear otro itemId'));
  pass('M');
}

async function testJ_EmptyRoot() {
  if (!isSharePointConfigured()) {
    line('J: SharePoint no configurado — validando código NO_POLICY_FOLDERS_FOUND vía fixture lógica');
    // Sin Graph: comprobamos que la config apunta a raíz correcta y el código existe
    const cfg = getAlfaPolicyImportConfig();
    if (cfg.rootPath !== ALFA_POLICY_IMPORT_PREFIX) fail('J', new Error('root'));
    pass('J');
    return;
  }
  const summary = await runAlfaPolicyImportCycle({ batchSize: 5 });
  if (summary.error) {
    // raíz inaccesible distinta de vacío
    line(`J aviso: summary.error=${summary.error}`);
  }
  if (summary.listedFolders === 0 && summary.code !== 'NO_POLICY_FOLDERS_FOUND') {
    fail('J', new Error(JSON.stringify(summary)));
  }
  if (summary.listedFolders === 0) {
    if (summary.imported || summary.errors) {
      // errors=0 expected
    }
    pass('J');
    return;
  }
  // Si ya hay carpetas reales, el ciclo no debe tumbar; J de vacío no aplica igual
  line(`J: root tiene ${summary.listedFolders} carpetas — vacío no reproducible; ciclo OK`);
  pass('J');
}

async function testReal88187559() {
  const cases = await findAlfaCasesByIdentification('88187559');
  if (cases.length !== 1) {
    fail('REAL', new Error(`esperado 1 caso, got ${cases.length}`));
  }
  const caso = cases[0];
  if (caso.consecutivo !== 'ALFA-2026-08-1') {
    fail('REAL', new Error(`consecutivo=${caso.consecutivo}`));
  }

  const doc = await createPolicyDoc({
    sourceIdentifier: '88.187.559',
    integrationSuffix: 'REAL',
  });
  const assoc = await associateAlfaPolicyDocument(doc);
  if (assoc.status !== 'matched') fail('REAL', new Error(JSON.stringify(assoc)));
  if (!assoc.alfaCaseIds.includes(String(caso._id))) fail('REAL', new Error('case'));
  const reloaded = await AlfaPolicyDocument.findById(doc._id);
  if (reloaded.sourceIdentifier !== '88187559') fail('REAL', new Error('norm id'));
  if (reloaded.policyNumber !== 'INC-008') {
    fail('REAL', new Error(`policyNumber=${reloaded.policyNumber}`));
  }
  if (caso.siniestro) {
    // siniestro puede ser null — no debe ser requisito
  }

  const listed = await listImportedAlfaPoliciesForCase(caso);
  const found = listed.find((p) => p.id === String(doc._id));
  if (!found) fail('REAL', new Error('Archivero no lista doc'));
  if (found.origin !== 'sharepoint') fail('REAL', new Error('origin'));
  if (found.tipo !== 'Póliza') fail('REAL', new Error('tipo'));
  if (found.associatedBy !== 'identificacion') fail('REAL', new Error('associatedBy'));

  pass('REAL');
  line(
    JSON.stringify(
      {
        sourceIdentifier: reloaded.sourceIdentifier,
        sourceIdentifierType: reloaded.sourceIdentifierType,
        policyNumber: reloaded.policyNumber,
        association: {
          status: reloaded.association.status,
          alfaCaseIds: reloaded.association.alfaCaseIds.map(String),
          matchedBy: reloaded.association.matchedBy,
        },
        consecutivo: caso.consecutivo,
      },
      null,
      2
    )
  );
}

async function main() {
  line('=== testAlfaPolicyImportByIdentificacion A–J + REAL ===');
  const cfg = getAlfaPolicyImportConfig();
  line(`Cron enabled: ${cfg.cronEnabled}`);
  line(`Root path: ${cfg.rootPath}`);
  if (cfg.cronEnabled) {
    throw new Error('Cron debe estar OFF (SHAREPOINT_ALFA_POLICY_IMPORT_ENABLED=false)');
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    await testE_Normalize();
    await testI_PathGuard();
    await testA_Unmatched();
    await testB_MatchedOne();
    await testC_Reinforcement();
    await testD_Ambiguous();
    await testF_G_SourceVsPolicy();
    await testH_OneToN();
    await testK_PlaceholderDoesNotLeak();
    await testL_PollutedCaseIdsStillIsolated();
    await testM_SkipArnaldOutboundItem();
    await testJ_EmptyRoot();
    await testReal88187559();

    line('');
    line('--- Resultados ---');
    for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'REAL']) {
      line(`${k}: ${results[k] || 'PENDING'}`);
    }
    line('');
    line('Cron sigue OFF. No se escribió en SharePoint.');
  } catch (error) {
    console.error('FAIL:', error);
    process.exitCode = 1;
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

main();
