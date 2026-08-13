/**
 * LIMPIEZA CONTROLADA E2E Alfa — solo ítems aprobados SAFE_TO_DELETE_TEST / SAFE_TO_REVERT.
 * NO deleteMany({}). NO migra históricos. NO borra casos.
 *
 *   node scripts/cleanupAlfaE2eApproved.js
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import ClaimDocument from '../models/ClaimDocument.js';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import { deleteItem } from '../services/microsoftGraphService.js';
import * as s3 from '../services/s3StorageService.js';
import { enqueueAlfaExcelOutboundFromCaseUpdate } from '../services/alfaExcelOutboundService.js';
import { runAlfaExcelOutboundCycle } from '../services/alfaExcelOutboundService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const CASE_1 = '6a7c96aa54984615b6dff255';
const CASE_10 = '6a7c96aa54984615b6dff25e';

const SP_ITEM_IDS = [
  '01ZPQ2ABM2LTNPNX6QLRGK7GUFC6P7PGBK', // e2e-fotos
  '01ZPQ2ABIUD6UYIUI2LZBITSJBCQV73UHD', // e2e-informe
  '01ZPQ2ABNLO7IR7ETHVZELFEV4HNHNDYVR', // e2e-inspeccion
  '01ZPQ2ABKIUEGBBVH45JA3CBAE32YK7M2Y', // e2e-liquidacion
  '01ZPQ2ABNMRNGQM6RRDNCYLTAWBD7AWN5Q', // e2e-otro
  '01ZPQ2ABLOWLC3QZA4DBBIVFE3577VPFWT', // poliza-prueba-e2e
];

const CLAIM_IDS = [
  '6a7df6ec387857ea7f973b06',
  '6a7df6f5387857ea7f973b07',
  '6a7df6fc387857ea7f973b08',
  '6a7df702387857ea7f973b09',
  '6a7df708387857ea7f973b0a',
];

const POLICY_IDS = [
  '6a7df7141cea02eace140e5c',
  '6a7df78a503d99fba72f49e7',
  '6a7df78c503d99fba72f49ec',
  '6a7df78e503d99fba72f49f1',
  '6a7df78f503d99fba72f49f6',
  '6a7df790503d99fba72f49fb',
];

const ARCHIVO_IDS = [
  '6a7df6ec1cea02eace140e1f',
  '6a7df6f51cea02eace140e2f',
  '6a7df6fc1cea02eace140e3a',
  '6a7df7031cea02eace140e45',
  '6a7df7091cea02eace140e50',
];

const S3_KEYS = [
  'seguros-alfa/6a7c96aa54984615b6dff255/e2e/e2e-fotos-1786640103547.jpg',
  'seguros-alfa/6a7c96aa54984615b6dff255/e2e/e2e-informe-1786640103547.docx',
  'seguros-alfa/6a7c96aa54984615b6dff255/e2e/e2e-inspeccion-1786640103547.txt',
  'seguros-alfa/6a7c96aa54984615b6dff255/e2e/e2e-liquidacion-1786640103547.txt',
  'seguros-alfa/6a7c96aa54984615b6dff255/e2e/e2e-otro-1786640103547.txt',
  'seguros-alfa/polizas/88187559/e2e-fotos-1786640103547.jpg',
  'seguros-alfa/polizas/88187559/e2e-informe-1786640103547.docx',
  'seguros-alfa/polizas/88187559/e2e-inspeccion-1786640103547.txt',
  'seguros-alfa/polizas/88187559/e2e-liquidacion-1786640103547.txt',
  'seguros-alfa/polizas/88187559/e2e-otro-1786640103547.txt',
  'seguros-alfa/polizas/88187559/poliza-prueba-e2e-1786640103547.pdf',
];

const report = {
  casosBorrados: 0,
  datosLegitimosPerdidos: 0,
  spDeleted: [],
  s3Deleted: [],
  claimsCleaned: [],
  policiesCleaned: [],
  fieldsReverted: [],
  excelOutboundIds: [],
  errors: [],
};

function line(m) {
  console.log(m);
}

await mongoose.connect(process.env.MONGO_URI);
line('=== CLEANUP E2E ALFA (APPROVED) ===\n');

// Guard: never delete cases
const keep1 = await SegurosAlfaCaso.findById(CASE_1).select('consecutivo').lean();
const keep10 = await SegurosAlfaCaso.findById(CASE_10).select('consecutivo').lean();
if (!keep1 || !keep10) throw new Error('Casos piloto no encontrados — abort');
line(`KEEP cases: ${keep1.consecutivo}, ${keep10.consecutivo}`);

// 1) SharePoint files
line('\n--- SharePoint delete test files ---');
for (const itemId of SP_ITEM_IDS) {
  try {
    await deleteItem(itemId);
    report.spDeleted.push(itemId);
    line(`SP deleted ${itemId}`);
  } catch (e) {
    const msg = String(e.message || e);
    if (/not found|404|itemNotFound/i.test(msg)) {
      line(`SP already gone ${itemId}`);
      report.spDeleted.push(`${itemId} (already gone)`);
    } else {
      report.errors.push(`SP ${itemId}: ${msg}`);
      line(`SP FAIL ${itemId}: ${msg}`);
    }
  }
}

// 2) S3
line('\n--- S3 delete test objects ---');
for (const key of S3_KEYS) {
  try {
    await s3.deleteObject(key);
    report.s3Deleted.push(key);
    line(`S3 deleted ${key}`);
  } catch (e) {
    report.errors.push(`S3 ${key}: ${e.message}`);
    line(`S3 FAIL ${key}: ${e.message}`);
  }
}

// 3) ClaimDocuments soft-delete
line('\n--- ClaimDocument soft-delete ---');
for (const id of CLAIM_IDS) {
  const doc = await ClaimDocument.findById(id);
  if (!doc) {
    line(`Claim missing ${id}`);
    continue;
  }
  if (!/e2e-/i.test(doc.originalName || '')) {
    report.errors.push(`Claim ${id} name not e2e — SKIP`);
    continue;
  }
  doc.status = 'deleted';
  if (doc.sharepoint) {
    doc.sharepoint.enabled = false;
    doc.sharepoint.syncStatus = 'disabled';
  }
  await doc.save();
  report.claimsCleaned.push({
    id: String(doc._id),
    name: doc.originalName,
    path: doc.sharepoint?.path,
    s3: doc.storage?.key,
  });
  line(`Claim deleted(soft) ${id} ${doc.originalName}`);
}

// 4) AlfaPolicyDocument soft-delete
line('\n--- AlfaPolicyDocument soft-delete ---');
for (const id of POLICY_IDS) {
  const doc = await AlfaPolicyDocument.findById(id);
  if (!doc) {
    line(`Policy missing ${id}`);
    continue;
  }
  if (!/e2e-|poliza-prueba/i.test(doc.originalName || '')) {
    report.errors.push(`Policy ${id} name not e2e — SKIP`);
    continue;
  }
  doc.status = 'deleted';
  await doc.save();
  report.policiesCleaned.push({
    id: String(doc._id),
    name: doc.originalName,
    path: doc.sharepoint?.path,
    s3: doc.storage?.key,
  });
  line(`Policy deleted(soft) ${id} ${doc.originalName}`);
}

// Guard: legitimate policy still active
const realPol = await AlfaPolicyDocument.findById('6a7de7da2cd057f18e2ea569');
if (!realPol || realPol.status !== 'active') {
  report.datosLegitimosPerdidos += 1;
  report.errors.push('Póliza real INC-006 no está active — REVISAR');
} else {
  line(`KEEP real policy OK: ${realPol.originalName}`);
}

// 5) Remove archivos from case 1 + revert fields
line('\n--- Case field + archivero cleanup ---');
{
  const before = await SegurosAlfaCaso.findById(CASE_1);
  const beforeObj = before.toObject();
  const beforeArchivos = [...(before.archivos || [])];
  before.archivos = (before.archivos || []).filter(
    (a) => !ARCHIVO_IDS.includes(String(a._id)) && !/e2e-/i.test(a.nombreOriginal || '')
  );
  const removed = beforeArchivos.length - before.archivos.length;

  const fieldChanges = {};
  if (before.fechaUltimoDocumento != null) {
    fieldChanges.fechaUltimoDocumento = {
      from: before.fechaUltimoDocumento,
      to: null,
    };
    before.fechaUltimoDocumento = undefined;
    before.set('fechaUltimoDocumento', null);
  }
  if (before.valorLiquidado === 0 || before.valorLiquidado === null) {
    // approved: 0 → null
    if (before.valorLiquidado !== null && before.valorLiquidado !== undefined) {
      fieldChanges.valorLiquidado = { from: before.valorLiquidado, to: null };
      before.set('valorLiquidado', null);
    }
  }
  if (before.valorReclamado === 0) {
    fieldChanges.valorReclamado = { from: before.valorReclamado, to: null };
    before.set('valorReclamado', null);
  }

  await before.save();
  const after = await SegurosAlfaCaso.findById(CASE_1);
  line(`ALFA-2026-08-1 archivos removed=${removed} remaining=${(after.archivos || []).length}`);

  for (const [field, diff] of Object.entries(fieldChanges)) {
    report.fieldsReverted.push({
      caso: 'ALFA-2026-08-1',
      campo: field,
      valorPrueba: diff.from,
      valorRestaurado: diff.to,
    });
  }

  const outbound = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: beforeObj,
    afterDoc: after,
  });
  if (outbound?._id) {
    report.excelOutboundIds.push(String(outbound._id));
    line(`Outbound enqueued 08-1 ${outbound._id}`);
  }
}

{
  const before = await SegurosAlfaCaso.findById(CASE_10);
  const beforeObj = before.toObject();
  const fieldChanges = {};

  if (before.valorLiquidado === 0) {
    fieldChanges.valorLiquidado = { from: before.valorLiquidado, to: null };
    before.set('valorLiquidado', null);
  }
  if (before.valorReclamado === 0) {
    fieldChanges.valorReclamado = { from: before.valorReclamado, to: null };
    before.set('valorReclamado', null);
  }
  if (String(before.estado || '').toUpperCase() === 'EN GESTION') {
    fieldChanges.estado = { from: before.estado, to: 'PENDIENTE' };
    before.estado = 'PENDIENTE';
  }
  // fechaUltimoDocumento KEEP (informe real)

  await before.save();
  const after = await SegurosAlfaCaso.findById(CASE_10);

  for (const [field, diff] of Object.entries(fieldChanges)) {
    report.fieldsReverted.push({
      caso: 'ALFA-2026-08-10',
      campo: field,
      valorPrueba: diff.from,
      valorRestaurado: diff.to,
    });
  }
  line(
    `ALFA-2026-08-10 estado=${after.estado} valorLiquidado=${after.valorLiquidado} fechaUltimoDocumento=${after.fechaUltimoDocumento}`
  );

  const outbound = await enqueueAlfaExcelOutboundFromCaseUpdate({
    beforeDoc: beforeObj,
    afterDoc: after,
  });
  if (outbound?._id) {
    report.excelOutboundIds.push(String(outbound._id));
    line(`Outbound enqueued 08-10 ${outbound._id}`);
  }
}

// 6) Process Excel outbound now
line('\n--- Excel outbound cycle ---');
try {
  const cycle = await runAlfaExcelOutboundCycle({ batchSize: 10 });
  line(JSON.stringify(cycle, null, 2));
} catch (e) {
  report.errors.push(`Outbound cycle: ${e.message}`);
  line(`Outbound cycle FAIL: ${e.message}`);
}

// Final validation
line('\n--- VALIDATION ---');
const c1 = await SegurosAlfaCaso.findById(CASE_1).lean();
const c10 = await SegurosAlfaCaso.findById(CASE_10).lean();
const archE2e = (c1.archivos || []).filter((a) => /e2e-|poliza-prueba/i.test(a.nombreOriginal || ''));
const claimsLeft = await ClaimDocument.countDocuments({
  _id: { $in: CLAIM_IDS },
  status: 'active',
});
const polLeft = await AlfaPolicyDocument.countDocuments({
  _id: { $in: POLICY_IDS },
  status: 'active',
});
const realStill = await AlfaPolicyDocument.findById('6a7de7da2cd057f18e2ea569')
  .select('status originalName')
  .lean();
const casesExist = await SegurosAlfaCaso.countDocuments({
  _id: { $in: [CASE_1, CASE_10] },
});

line(
  JSON.stringify(
    {
      casosRealesBorrados: casesExist === 2 ? 0 : 'ERROR',
      archiveroE2eRestantes: archE2e.length,
      claimsActiveRestantes: claimsLeft,
      policiesActiveRestantes: polLeft,
      polizaReal: realStill,
      c1: {
        fechaUltimoDocumento: c1.fechaUltimoDocumento,
        valorLiquidado: c1.valorLiquidado,
        valorReclamado: c1.valorReclamado,
        archivos: (c1.archivos || []).length,
      },
      c10: {
        estado: c10.estado,
        valorLiquidado: c10.valorLiquidado,
        valorReclamado: c10.valorReclamado,
        fechaUltimoDocumento: c10.fechaUltimoDocumento,
      },
    },
    null,
    2
  )
);

line('\n=== RESUMEN ===');
line(`CASOS REALES BORRADOS: ${casesExist === 2 ? 0 : 'ERROR'}`);
line(`DATOS LEGÍTIMOS PERDIDOS: ${report.datosLegitimosPerdidos}`);
line(`TEST FILES SHAREPOINT ELIMINADOS: ${report.spDeleted.length}`);
line(`TEST OBJECTS S3 ELIMINADOS: ${report.s3Deleted.length}`);
line(`TEST CLAIMDOCUMENTS LIMPIADOS: ${report.claimsCleaned.length}`);
line(`TEST POLICIES LIMPIADAS: ${report.policiesCleaned.length}`);
line(`CAMPOS DE CASO REVERTIDOS: ${report.fieldsReverted.length}`);
line(`CELDAS EXCEL (outbound jobs): ${report.excelOutboundIds.length}`);

line('\nCampos revertidos:');
for (const f of report.fieldsReverted) {
  line(
    `  ${f.caso} | ${f.campo} | prueba=${JSON.stringify(f.valorPrueba)} → restaurado=${JSON.stringify(f.valorRestaurado)}`
  );
}

line('\nArchivos eliminados:');
for (const x of [...report.claimsCleaned, ...report.policiesCleaned]) {
  line(`  ${x.name} | SP=${x.path || '-'} | S3=${x.s3 || '-'} | id=${x.id}`);
}

if (report.errors.length) {
  line('\nERRORS:');
  for (const e of report.errors) line(`  - ${e}`);
}

await mongoose.disconnect();
process.exit(report.errors.length && claimsLeft === 0 && archE2e.length === 0 ? 0 : report.errors.length ? 1 : 0);
