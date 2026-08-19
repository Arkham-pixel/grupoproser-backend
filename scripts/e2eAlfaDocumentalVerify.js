/**
 * Verificación E2E post-sync (no re-sube outbound).
 * Por defecto NO usa casos reales.
 *
 *   node scripts/e2eAlfaDocumentalVerify.js --allow-real-case [stamp]
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import ClaimDocument from '../models/ClaimDocument.js';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import {
  getAccessToken,
  getFolderByPath,
  listFolder,
  getItemMetadata,
  uploadSmallFile,
} from '../services/microsoftGraphService.js';
import { runAlfaPolicyImportCycle } from '../services/alfaPolicyImportService.js';
import { listImportedAlfaPoliciesForCase } from '../services/alfaPolicyImportService.js';
import { buildAlfaSharePointDocumentsStatus } from '../services/alfaSharePointStatusService.js';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';
import { enqueueAlfaClaimDocumentAfterUpload } from '../services/alfaClaimDocumentEnqueueService.js';
import { syncClaimDocument } from '../services/claimDocumentSyncService.js';
import * as s3 from '../services/s3StorageService.js';
import { sanitizeStoredFileName } from '../utils/sharepointClaimPath.js';
import { parseE2eArgs, assertAllowRealCaseOrExit } from './lib/alfaE2eGuard.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const { allowRealCase, stampArg } = parseE2eArgs();
assertAllowRealCaseOrExit({
  allowRealCase,
  scriptName: 'e2eAlfaDocumentalVerify.js',
});

const PILOT = {
  identificacion: '88187559',
  numeroPoliza: 'INC-008',
  consecutivo: 'ALFA-2026-08-1',
};
const ROOT = `SEGUROS ALFA/PÓLIZAS/${PILOT.identificacion} - ${PILOT.numeroPoliza}`;
const STAMP = stampArg || '1786640103547';

function line(m) {
  console.log(m);
}

async function listChildren(path) {
  const listed = await listFolder(path, { top: 200 });
  return Array.isArray(listed) ? listed : listed?.children || [];
}

await mongoose.connect(process.env.MONGO_URI);
await getAccessToken();

const caso = await SegurosAlfaCaso.findOne({
  consecutivo: PILOT.consecutivo,
  identificacion: PILOT.identificacion,
}).exec();
if (!caso) throw new Error('Caso piloto no encontrado');

line('=== VERIFY E2E DOCUMENTAL ALFA ===');
line(`stamp=${STAMP} caso=${caso._id}`);
line(
  `FLAGS sync=${process.env.SHAREPOINT_SYNC_ALFA_ENABLED} policy=${process.env.SHAREPOINT_ALFA_POLICY_IMPORT_ENABLED} outbound=${process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED} excelIn=${process.env.SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED}`
);

const typeOrder = ['FOTOS', 'INSPECCION', 'LIQUIDACION', 'OTRO', 'INFORME'];
const typeMap = {
  FOTOS: 'fotografia',
  INSPECCION: 'inspeccion',
  LIQUIDACION: 'liquidacion',
  OTRO: 'otro',
  INFORME: 'informe',
};
const folderMap = {
  fotografia: 'FOTOS',
  inspeccion: 'INSPECCION',
  liquidacion: 'LIQUIDACION',
  otro: 'OTRO',
  informe: 'INFORMES',
};

const results = [];

for (const etiqueta of typeOrder) {
  const docType = typeMap[etiqueta];
  const doc = await ClaimDocument.findOne({
    claimId: caso._id,
    sourceModule: 'alfa',
    documentType: docType,
    originalName: new RegExp(STAMP),
    status: { $ne: 'deleted' },
  })
    .sort({ createdAt: -1 })
    .lean();

  let graphOk = false;
  let graphHit = null;
  if (doc?.sharepoint?.itemId) {
    try {
      const meta = await getItemMetadata(doc.sharepoint.itemId);
      graphOk = Boolean(meta?.id);
      graphHit = meta;
    } catch (e) {
      graphOk = false;
    }
  }
  if (!graphOk && doc?.originalName) {
    const folder = `${ROOT}/${folderMap[docType]}`;
    try {
      const kids = await listChildren(folder);
      graphHit = kids.find((k) => k.name === doc.originalName) || null;
      graphOk = Boolean(graphHit);
    } catch {
      /* ignore */
    }
  }

  const pass =
    Boolean(doc?.storage?.key) &&
    doc?.sharepoint?.syncStatus === 'synced' &&
    graphOk &&
    String(doc?.sharepoint?.path || '').includes(ROOT);

  results.push({
    tipo: etiqueta,
    archivo: doc?.originalName || null,
    s3: doc?.storage?.key || null,
    claimOrPolicy: doc?._id ? String(doc._id) : null,
    rutaSp: doc?.sharepoint?.path || null,
    status: doc?.sharepoint?.syncStatus || 'missing',
    itemId: doc?.sharepoint?.itemId || graphHit?.id || null,
    webUrl: doc?.sharepoint?.webUrl || graphHit?.webUrl || null,
    pass,
  });
  line(`${etiqueta}: ${pass ? 'PASS' : 'FAIL'} ${doc?.sharepoint?.path || ''}`);
}

// POLIZA inbound — reimport existing file or upload if missing
line('--- POLIZA inbound ---');
const polizaFolder = `${ROOT}/POLIZA`;
let polizaItem = null;
try {
  const kids = await listChildren(polizaFolder);
  polizaItem =
    kids.find((k) => String(k.name || '').includes(`poliza-prueba-e2e-${STAMP}`)) ||
    kids.find((k) => String(k.name || '').includes('poliza-prueba-e2e-')) ||
    null;
} catch {
  polizaItem = null;
}

if (!polizaItem) {
  const name = `poliza-prueba-e2e-${STAMP}.pdf`;
  const buf = Buffer.from(
    `%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\nE2E POLIZA ${STAMP}\n`,
    'utf8'
  );
  polizaItem = await uploadSmallFile(polizaFolder, name, buf, {
    contentType: 'application/pdf',
  });
  line(`Uploaded missing poliza: ${name}`);
}

const summary1 = await runAlfaPolicyImportCycle({ batchSize: 50 });
const summary2 = await runAlfaPolicyImportCycle({ batchSize: 50 });
line(`import1=${JSON.stringify(summary1)}`);
line(`import2 skippedAlready=${summary2.skippedAlready} imported=${summary2.imported}`);

const polDoc = await AlfaPolicyDocument.findOne({
  $or: [
    { 'sharepoint.itemId': polizaItem.id },
    { originalName: new RegExp(String(polizaItem.name || STAMP)) },
  ],
  status: 'active',
})
  .sort({ createdAt: -1 })
  .lean();

const matched =
  polDoc &&
  polDoc.association?.status === 'matched' &&
  (polDoc.association?.alfaCaseIds || []).some((id) => String(id) === String(caso._id));

results.push({
  tipo: 'POLIZA inbound',
  archivo: polDoc?.originalName || polizaItem?.name,
  s3: polDoc?.storage?.key || null,
  claimOrPolicy: polDoc?._id ? String(polDoc._id) : null,
  rutaSp: polDoc?.sharepoint?.path || null,
  status: polDoc?.association?.status || 'missing',
  itemId: polDoc?.sharepoint?.itemId || polizaItem?.id || null,
  webUrl: polDoc?.sharepoint?.webUrl || null,
  pass: Boolean(matched && polDoc?.storage?.key),
  matchedBy: polDoc?.association?.matchedBy || null,
});
line(`POLIZA inbound: ${matched && polDoc?.storage?.key ? 'PASS' : 'FAIL'}`);

// Archivero
const fresh = await SegurosAlfaCaso.findById(caso._id).lean();
const inbound = await listImportedAlfaPoliciesForCase(fresh);
const sp = await buildAlfaSharePointDocumentsStatus(fresh);
const hasInforme = (fresh.archivos || []).some(
  (a) => String(a.etiqueta).toUpperCase() === 'INFORME' && String(a.nombreOriginal).includes(STAMP)
);
const hasFotos = (fresh.archivos || []).some(
  (a) => String(a.etiqueta).toUpperCase() === 'FOTOS' && String(a.nombreOriginal).includes(STAMP)
);
const hasInbound = (inbound || []).some(
  (p) =>
    String(p.originalName || '').includes('poliza-prueba') ||
    String(p.originalName || '').includes(STAMP)
);
const archiveroPass = hasInforme && hasFotos && hasInbound && (fresh.archivos || []).length >= 5;
line(
  `ARCHIVERO UNIFICADO: ${archiveroPass ? 'PASS' : 'FAIL'} arnald=${(fresh.archivos || []).length} inbound=${inbound.length} sync=${JSON.stringify(sp.summary)}`
);

// PENDING fixture quick
const stampPend = Date.now();
const pendingCaso = await SegurosAlfaCaso.create({
  consecutivo: `E2E-PEND-${stampPend}`,
  identificacion: '',
  numeroPoliza: 'POR CONFIRMAR OPERACIONES',
  estado: 'PENDIENTE',
  archivos: [],
});
const fileName = `e2e-pending-${stampPend}.txt`;
const s3Key = `seguros-alfa/${pendingCaso._id}/e2e/${fileName}`;
const body = Buffer.from('pending\n');
await s3.putObject({ key: s3Key, body, contentType: 'text/plain' });
pendingCaso.archivos.push({
  nombreOriginal: fileName,
  nombreArchivo: sanitizeStoredFileName(fileName),
  ruta: `s3:${s3Key}`,
  tamaño: body.length,
  tipoMime: 'text/plain',
  etiqueta: 'GENERAL',
  fechaSubida: new Date(),
});
await pendingCaso.save();
const creado = pendingCaso.archivos[pendingCaso.archivos.length - 1];
const enq = await enqueueAlfaClaimDocumentAfterUpload({
  caso: pendingCaso,
  archivo: creado,
  req: {
    file: { originalname: fileName, mimetype: 'text/plain', size: body.length },
    fileStorage: {
      driver: 's3',
      s3Key,
      filename: sanitizeStoredFileName(fileName),
      publicPath: `s3:${s3Key}`,
      size: body.length,
      mimetype: 'text/plain',
    },
    usuario: { login: 'e2e' },
  },
  etiqueta: 'GENERAL',
});
const docId = enq?.document?._id;
const pendDoc = await ClaimDocument.findById(docId).lean();
await syncClaimDocument(docId);
let bad = false;
try {
  bad = Boolean(
    (await getFolderByPath('SEGUROS ALFA/PÓLIZAS/99887766 - POR CONFIRMAR OPERACIONES'))?.id
  );
} catch {
  bad = false;
}
const pendingPass =
  pendDoc?.destinationStatus === 'pending_destination' &&
  pendDoc?.destinationReason === 'MISSING_IDENTIFICATION' &&
  !bad;
line(`PENDING_DESTINATION: ${pendingPass ? 'PASS' : 'FAIL'}`);
await ClaimDocument.deleteOne({ _id: docId });
await SegurosAlfaCaso.deleteOne({ _id: pendingCaso._id });
try {
  await s3.deleteObject(s3Key);
} catch {
  /* ignore */
}

const outbound = getAlfaExcelOutboundConfig();
const excelPass =
  outbound.cronEnabled === true && process.env.SHAREPOINT_ALFA_EXCEL_IMPORT_ENABLED === 'false';
line(`EXCEL R–AB REGRESSION: ${excelPass ? 'PASS' : 'FAIL'}`);

const histPaths = [
  'SEGUROS ALFA/SINIESTROS',
  'SEGUROS ALFA/SINIESTROS/PENDIENTES_NUMERO_SINIESTRO',
  'SEGUROS ALFA/SINIESTROS/88187559',
];
const hist = [];
for (const p of histPaths) {
  try {
    const f = await getFolderByPath(p);
    hist.push({ path: p, exists: Boolean(f?.id) });
  } catch (e) {
    hist.push({ path: p, exists: false, error: e.message });
  }
}
const histPass = hist.every((h) => h.exists);
line(`HISTÓRICOS INTACTOS: ${histPass ? 'PASS' : 'FAIL'} ${JSON.stringify(hist)}`);

const rootKids = await listChildren(ROOT);
line(
  `ROOT subfolders: ${rootKids
    .filter((c) => c.folder)
    .map((c) => c.name)
    .sort()
    .join(', ')}`
);

line('');
line('TIPO | ARCHIVO | S3 | CLAIM/POLICY | RUTA SP | STATUS | ITEMID | PASS');
for (const r of results) {
  line(
    [
      r.tipo,
      r.archivo,
      r.s3 ? 'OK' : 'NO',
      r.claimOrPolicy || '-',
      r.rutaSp || '-',
      r.status,
      r.itemId || '-',
      r.pass ? 'PASS' : 'FAIL',
    ].join(' | ')
  );
}

const allPass =
  results.every((r) => r.pass) && archiveroPass && pendingPass && excelPass && histPass;
line('');
line(`ARCHIVERO UNIFICADO: ${archiveroPass ? 'PASS' : 'FAIL'}`);
line(`PENDING_DESTINATION: ${pendingPass ? 'PASS' : 'FAIL'}`);
line(`EXCEL R–AB REGRESSION: ${excelPass ? 'PASS' : 'FAIL'}`);
line(`HISTÓRICOS INTACTOS: ${histPass ? 'PASS' : 'FAIL'}`);
line(allPass ? 'E2E DOCUMENTAL ALFA: PASSED' : 'E2E DOCUMENTAL ALFA: FAILED');
line('NO MIGRATION.');

await mongoose.disconnect();
process.exit(allPass ? 0 : 1);
