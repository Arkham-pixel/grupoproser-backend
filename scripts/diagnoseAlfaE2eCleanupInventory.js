/**
 * DIAGNÓSTICO SOLO LECTURA — inventario datos E2E Alfa.
 * NO borra, NO revierte, NO migra.
 *
 *   node scripts/diagnoseAlfaE2eCleanupInventory.js
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import ClaimDocument from '../models/ClaimDocument.js';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelImport from '../models/AlfaExcelImport.js';
import AlfaExcelImportRow from '../models/AlfaExcelImportRow.js';
import {
  getAccessToken,
  listFolder,
  getFolderByPath,
  getItemMetadata,
} from '../services/microsoftGraphService.js';
import * as s3 from '../services/s3StorageService.js';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const NAME_RX =
  /e2e-|poliza-prueba|prueba-e2e|arnald-sharepoint-test|TEST-ARNALD|validacion\.monitor|TEST_E2E_|condiciones-prueba|poliza-cron-prueba|fase6-test|fase7|fase8/i;

const PILOT_ROOT = 'SEGUROS ALFA/PÓLIZAS/88187559 - INC-008';
const rows = [];

function add(row) {
  rows.push({
    tipo: row.tipo,
    id: row.id || '',
    caso: row.caso || '',
    nombreCampo: row.nombreCampo || '',
    valorActual: row.valorActual ?? '',
    origenPrueba: row.origenPrueba || '',
    accion: row.accion || 'REQUIRES_REVIEW',
    extra: row.extra || '',
  });
}

function listChildren(path) {
  return listFolder(path, { top: 200 }).then((listed) =>
    Array.isArray(listed) ? listed : listed?.children || []
  );
}

function isTestName(name) {
  return NAME_RX.test(String(name || ''));
}

await mongoose.connect(process.env.MONGO_URI);
console.log('=== DIAGNÓSTICO E2E CLEANUP (READ-ONLY) ===\n');

const casosPilot = await SegurosAlfaCaso.find({
  $or: [
    { consecutivo: { $in: ['ALFA-2026-08-1', 'ALFA-2026-08-10'] } },
    { identificacion: { $in: ['88187559', '19247256'] } },
    { consecutivo: /^E2E-PEND-/i },
    { consecutivo: /^TEST-/i },
  ],
})
  .select(
    'consecutivo identificacion numeroPoliza estado correo reserva valorLiquidado fechaUltimoDocumento fechaInspeccion archivos updatedAt createdAt'
  )
  .lean();

console.log('Casos relevantes:', casosPilot.map((c) => c.consecutivo).join(', '));

for (const c of casosPilot) {
  if (/^E2E-PEND-/i.test(c.consecutivo || '')) {
    add({
      tipo: 'SegurosAlfaCaso',
      id: String(c._id),
      caso: c.consecutivo,
      nombreCampo: 'caso fixture',
      valorActual: `${c.identificacion} / ${c.numeroPoliza}`,
      origenPrueba: 'PENDING_DESTINATION fixture',
      accion: 'SAFE_TO_DELETE_TEST',
    });
  }

  for (const a of c.archivos || []) {
    const name = a.nombreOriginal || a.nombreArchivo || '';
    if (isTestName(name) || /e2e-doc/i.test(a.subidoPor?.login || '')) {
      add({
        tipo: 'Caso.archivo (Archivero)',
        id: String(a._id),
        caso: c.consecutivo,
        nombreCampo: name,
        valorActual: a.ruta || '',
        origenPrueba: `etiqueta=${a.etiqueta}; subidoPor=${a.subidoPor?.login || ''}`,
        accion: 'SAFE_TO_DELETE_TEST',
        extra: `fechaSubida=${a.fechaSubida || ''}`,
      });
    } else {
      add({
        tipo: 'Caso.archivo (Archivero)',
        id: String(a._id),
        caso: c.consecutivo,
        nombreCampo: name,
        valorActual: a.ruta || '',
        origenPrueba: 'posible real (nombre no match E2E)',
        accion: 'KEEP_REAL_DATA',
      });
    }
  }
}

// ClaimDocuments test-like
const claimQ = {
  sourceModule: 'alfa',
  $or: [
    { originalName: NAME_RX },
    { storedName: NAME_RX },
    { 'storage.key': /\/e2e\//i },
    { 'storage.key': /test\/sharepoint-sync/i },
    { 'sharepoint.path': /e2e-|poliza-prueba-e2e|TEST-ARNALD/i },
    { claimNumber: /^E2E-PEND-/i },
    { claimNumber: /^TEST-ARNALD/i },
    { uploadedByLogin: /e2e|fase6|fase7|fase8/i },
  ],
};
const claims = await ClaimDocument.find(claimQ)
  .select(
    'claimId claimNumber originalName storage.key sharepoint.path sharepoint.itemId sharepoint.syncStatus destinationStatus integrationKey status createdAt uploadedByLogin'
  )
  .lean();

for (const d of claims) {
  const caso = casosPilot.find((c) => String(c._id) === String(d.claimId));
  add({
    tipo: 'ClaimDocument',
    id: String(d._id),
    caso: caso?.consecutivo || d.claimNumber || String(d.claimId || ''),
    nombreCampo: d.originalName,
    valorActual: d.sharepoint?.path || d.storage?.key || '',
    origenPrueba: `status=${d.status}; sync=${d.sharepoint?.syncStatus}; key=${d.storage?.key}`,
    accion: 'SAFE_TO_DELETE_TEST',
    extra: `itemId=${d.sharepoint?.itemId || ''}; integrationKey=${d.integrationKey || ''}`,
  });
}

// AlfaPolicyDocuments test-like OR mirrored e2e under pilot
const policies = await AlfaPolicyDocument.find({
  $or: [
    { originalName: NAME_RX },
    { 'storage.key': /e2e-|poliza-prueba|\/e2e\//i },
    { 'sharepoint.path': /e2e-|poliza-prueba-e2e/i },
    { sourceIdentifier: '99887766' },
  ],
})
  .select(
    'originalName sourceIdentifier policyNumber documentType storage.key sharepoint.path sharepoint.itemId association.status association.alfaCaseIds status integrationKey createdAt'
  )
  .lean();

for (const d of policies) {
  const caseIds = (d.association?.alfaCaseIds || []).map(String);
  const caso = casosPilot.find((c) => caseIds.includes(String(c._id)));
  const isTest = isTestName(d.originalName) || /e2e/i.test(d.storage?.key || '');
  add({
    tipo: 'AlfaPolicyDocument',
    id: String(d._id),
    caso: caso?.consecutivo || d.sourceIdentifier || '',
    nombreCampo: `${d.originalName} (${d.documentType})`,
    valorActual: d.sharepoint?.path || d.storage?.key || '',
    origenPrueba: `assoc=${d.association?.status}; key=${d.storage?.key}`,
    accion: isTest ? 'SAFE_TO_DELETE_TEST' : 'REQUIRES_REVIEW',
    extra: `itemId=${d.sharepoint?.itemId || ''}`,
  });
}

// Legitimate policy on 88187559 for contrast
const realPolicies = await AlfaPolicyDocument.find({
  sourceIdentifier: '88187559',
  status: 'active',
  originalName: { $not: NAME_RX },
})
  .select('originalName sharepoint.path storage.key association.status')
  .lean();
for (const d of realPolicies) {
  add({
    tipo: 'AlfaPolicyDocument',
    id: String(d._id),
    caso: '88187559',
    nombreCampo: d.originalName,
    valorActual: d.sharepoint?.path || '',
    origenPrueba: 'documento inbound legítimo (nombre no E2E)',
    accion: 'KEEP_REAL_DATA',
  });
}

// Outbound updates involving pilot cases or test markers
const casoIds = casosPilot.map((c) => c._id);
const outbound = await AlfaExcelOutboundUpdate.find({
  $or: [
    { alfaCaseId: { $in: casoIds } },
    { 'changes.field': { $exists: true } },
  ],
})
  .sort({ createdAt: -1 })
  .limit(200)
  .lean();

const outboundForPilot = outbound.filter((o) =>
  casoIds.some((id) => String(id) === String(o.alfaCaseId))
);

for (const o of outboundForPilot.slice(0, 80)) {
  const caso = casosPilot.find((c) => String(c._id) === String(o.alfaCaseId));
  const changes = o.changes || o.payload?.changes || [];
  const changeList = Array.isArray(changes)
    ? changes
    : Object.entries(o.before || {}).map(([k]) => ({
        field: k,
        before: o.before?.[k],
        after: o.after?.[k],
      }));

  if (Array.isArray(o.changes) && o.changes.length) {
    for (const ch of o.changes) {
      add({
        tipo: 'AlfaExcelOutboundUpdate',
        id: String(o._id),
        caso: caso?.consecutivo || '',
        nombreCampo: ch.field || ch.column || JSON.stringify(ch).slice(0, 80),
        valorActual: `before=${JSON.stringify(ch.before)} → after=${JSON.stringify(ch.after ?? ch.value)}`,
        origenPrueba: `outbound status=${o.status}; createdAt=${o.createdAt}`,
        accion: 'REQUIRES_REVIEW',
        extra: 'Usar before para revertir Excel/caso si fue prueba',
      });
    }
  } else if (o.before || o.after) {
    const fields = new Set([
      ...Object.keys(o.before || {}),
      ...Object.keys(o.after || {}),
    ]);
    for (const field of fields) {
      if (['__v', '_id'].includes(field)) continue;
      const b = o.before?.[field];
      const a = o.after?.[field];
      if (JSON.stringify(b) === JSON.stringify(a)) continue;
      add({
        tipo: 'AlfaExcelOutboundUpdate',
        id: String(o._id),
        caso: caso?.consecutivo || '',
        nombreCampo: field,
        valorActual: `before=${JSON.stringify(b)} → after=${JSON.stringify(a)}`,
        origenPrueba: `outbound status=${o.status}; createdAt=${o.createdAt}`,
        accion: 'REQUIRES_REVIEW',
      });
    }
  } else {
    add({
      tipo: 'AlfaExcelOutboundUpdate',
      id: String(o._id),
      caso: caso?.consecutivo || '',
      nombreCampo: '(sin changes parseados)',
      valorActual: o.status || '',
      origenPrueba: `createdAt=${o.createdAt}`,
      accion: 'REQUIRES_REVIEW',
    });
  }
}

// Imports simulation
const imports = await AlfaExcelImport.find({
  $or: [
    { createdByLogin: /test|e2e|validacion/i },
    { notes: /test|e2e|simul/i },
    { source: /test|simul/i },
  ],
})
  .sort({ createdAt: -1 })
  .limit(30)
  .lean()
  .catch(() => []);

for (const imp of imports || []) {
  add({
    tipo: 'AlfaExcelImport',
    id: String(imp._id),
    caso: '',
    nombreCampo: imp.status || imp.mode || '',
    valorActual: imp.fileName || '',
    origenPrueba: `createdAt=${imp.createdAt}`,
    accion: 'REQUIRES_REVIEW',
  });
}

// Case field snapshot for pilot cases (current values — revert needs outbound before)
for (const c of casosPilot.filter((x) =>
  ['ALFA-2026-08-1', 'ALFA-2026-08-10'].includes(x.consecutivo)
)) {
  const fields = [
    'reserva',
    'valorLiquidado',
    'estado',
    'correo',
    'fechaUltimoDocumento',
    'fechaInspeccion',
  ];
  for (const f of fields) {
    add({
      tipo: 'Caso.campo (snapshot actual)',
      id: String(c._id),
      caso: c.consecutivo,
      nombreCampo: f,
      valorActual: c[f] == null ? 'null' : String(c[f]),
      origenPrueba: 'valor actual — cruzar con outbound before/after',
      accion: 'REQUIRES_REVIEW',
    });
  }
}

// SharePoint listing under pilot root
try {
  await getAccessToken();
  const root = await getFolderByPath(PILOT_ROOT);
  if (root?.id) {
    const subs = await listChildren(PILOT_ROOT);
    for (const sub of subs.filter((s) => s.folder)) {
      const files = await listChildren(`${PILOT_ROOT}/${sub.name}`);
      for (const f of files.filter((x) => x.file)) {
        const test = isTestName(f.name);
        add({
          tipo: 'SharePoint.file',
          id: f.id,
          caso: 'ALFA-2026-08-1',
          nombreCampo: f.name,
          valorActual: `${PILOT_ROOT}/${sub.name}/${f.name}`,
          origenPrueba: test ? 'nombre E2E' : 'posible real',
          accion: test ? 'SAFE_TO_DELETE_TEST' : 'KEEP_REAL_DATA',
          extra: `webUrl=${f.webUrl || ''}`,
        });
      }
      if (!files.filter((x) => x.file).length) {
        add({
          tipo: 'SharePoint.folder',
          id: sub.id,
          caso: 'ALFA-2026-08-1',
          nombreCampo: sub.name,
          valorActual: `${PILOT_ROOT}/${sub.name}`,
          origenPrueba: 'subcarpeta esquema (puede quedar vacía)',
          accion: 'KEEP_REAL_DATA',
        });
      }
    }
    add({
      tipo: 'SharePoint.folder',
      id: root.id,
      caso: 'ALFA-2026-08-1',
      nombreCampo: '88187559 - INC-008',
      valorActual: PILOT_ROOT,
      origenPrueba: 'carpeta operativa definitiva',
      accion: 'KEEP_REAL_DATA',
    });
  } else {
    add({
      tipo: 'SharePoint.folder',
      id: '',
      caso: 'ALFA-2026-08-1',
      nombreCampo: PILOT_ROOT,
      valorActual: 'NO EXISTE',
      origenPrueba: '',
      accion: 'KEEP_REAL_DATA',
    });
  }

  // Legacy TEST-ARNALD folders if any
  for (const p of [
    'SEGUROS ALFA/SINIESTROS/TEST-ARNALD-FASE6-001',
    'SEGUROS ALFA/SINIESTROS/TEST-ARNALD-FASE7-CRON-001',
    'SEGUROS ALFA/SINIESTROS/TEST-ARNALD-FASE8-UI-001',
  ]) {
    try {
      const f = await getFolderByPath(p);
      if (f?.id) {
        add({
          tipo: 'SharePoint.folder',
          id: f.id,
          caso: '',
          nombreCampo: p,
          valorActual: p,
          origenPrueba: 'piloto Fase 6/7/8',
          accion: 'SAFE_TO_DELETE_TEST',
        });
      }
    } catch {
      /* absent */
    }
  }
} catch (e) {
  console.warn('SharePoint inventory error:', e.message);
}

// S3 prefixes
try {
  const bucket = s3.getBucketName();
  const client = s3.getS3Client?.() || null;
  // Use list via s3 service if available; fallback prefixes from known keys
  const prefixes = [
    'seguros-alfa/6a7c96aa54984615b6dff255/e2e/',
    'seguros-alfa/polizas/88187559/',
    'test/sharepoint-sync/',
  ];

  // Dynamic: all claim/policy s3 keys already classified
  const s3Keys = new Set();
  for (const r of rows) {
    if (r.tipo === 'ClaimDocument' || r.tipo === 'AlfaPolicyDocument') {
      const m = String(r.origenPrueba || '').match(/key=([^\s;]+)/);
      if (m) s3Keys.add(m[1]);
    }
    if (String(r.valorActual || '').startsWith('s3:')) {
      s3Keys.add(String(r.valorActual).slice(3));
    }
    if (String(r.valorActual || '').includes('seguros-alfa/') && !r.valorActual.includes('/')) {
      /* skip */
    }
  }
  for (const c of casosPilot) {
    for (const a of c.archivos || []) {
      const ruta = String(a.ruta || '');
      if (ruta.startsWith('s3:') && isTestName(a.nombreOriginal)) {
        s3Keys.add(ruta.slice(3));
      }
    }
  }
  for (const d of [...claims, ...policies]) {
    if (d.storage?.key && (isTestName(d.originalName) || /\/e2e\//.test(d.storage.key))) {
      s3Keys.add(d.storage.key);
    }
  }

  for (const key of [...s3Keys].sort()) {
    let exists = false;
    try {
      await s3.headObject(key);
      exists = true;
    } catch {
      exists = false;
    }
    add({
      tipo: 'S3.object',
      id: key,
      caso: key.includes('6a7c96aa54984615b6dff255') ? 'ALFA-2026-08-1' : '',
      nombreCampo: key.split('/').pop(),
      valorActual: exists ? 'EXISTS' : 'MISSING',
      origenPrueba: `s3://${bucket}/${key}`,
      accion: exists && (isTestName(key) || /\/e2e\//.test(key) || /poliza-prueba|test\//i.test(key))
        ? 'SAFE_TO_DELETE_TEST'
        : exists
          ? 'REQUIRES_REVIEW'
          : 'KEEP_REAL_DATA',
    });
  }
} catch (e) {
  console.warn('S3 inventory error:', e.message);
}

// Summary counts
const byAccion = {};
for (const r of rows) {
  byAccion[r.accion] = (byAccion[r.accion] || 0) + 1;
}

console.log('\nTIPO | ID | CASO | NOMBRE/CAMPO | VALOR ACTUAL | ORIGEN PRUEBA | ACCIÓN PROPUESTA');
for (const r of rows) {
  console.log(
    [
      r.tipo,
      r.id,
      r.caso,
      String(r.nombreCampo).replace(/\|/g, '/'),
      String(r.valorActual).replace(/\|/g, '/').slice(0, 120),
      String(r.origenPrueba).replace(/\|/g, '/').slice(0, 100),
      r.accion,
    ].join(' | ')
  );
}

console.log('\n--- RESUMEN ACCIONES ---');
console.log(JSON.stringify(byAccion, null, 2));
console.log(`TOTAL FILAS: ${rows.length}`);
console.log('\nNO SE MODIFICÓ NADA. Esperando confirmación para limpieza.');

await mongoose.disconnect();
