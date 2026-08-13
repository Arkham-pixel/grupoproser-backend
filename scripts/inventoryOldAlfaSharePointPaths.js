/**
 * FASE 1 — Inventario histórico SharePoint Alfa (SOLO LECTURA).
 * NO mueve ni borra nada.
 *
 * Uso:
 *   node scripts/inventoryOldAlfaSharePointPaths.js
 *
 * Etiqueta de diagnóstico: OLD_ALFA_SHAREPOINT_PATH
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  classifyAlfaSharePointPath,
  proposeAlfaDocumentPath,
  getAlfaDocumentSubfolder,
} from '../utils/alfaDocumentPath.js';

await mongoose.connect(process.env.MONGO_URI);

const casesById = new Map();
async function loadCaso(caseId) {
  const key = String(caseId);
  if (casesById.has(key)) return casesById.get(key);
  const caso = await SegurosAlfaCaso.findById(caseId)
    .select('consecutivo identificacion numeroPoliza siniestro')
    .lean();
  casesById.set(key, caso);
  return caso;
}

const claims = await ClaimDocument.find({
  sourceModule: 'alfa',
  status: { $ne: 'deleted' },
})
  .select(
    'claimId claimNumber documentType sharepoint.path sharepoint.itemId sharepoint.webUrl sharepoint.syncStatus destinationStatus storage.key'
  )
  .lean();

const policies = await AlfaPolicyDocument.find({ status: 'active' })
  .select(
    'sourceIdentifier policyNumber documentType sharepoint.path sharepoint.itemId sharepoint.webUrl association.alfaCaseIds association.status storage.key'
  )
  .lean();

const rows = [];

for (const doc of claims) {
  const path = doc.sharepoint?.path || '';
  const classified = classifyAlfaSharePointPath(path);
  const isOld =
    classified.kind === 'OLD_ALFA_SHAREPOINT_PATH' ||
    classified.kind === 'LEGACY_COMPAT_POLIZAS_ID';
  if (!isOld && classified.kind === 'NEW_ALFA_DOCUMENT_PATH') continue;
  if (!path && classified.kind === 'empty') continue;

  // Inventariar todo lo que no sea NEW definitiva
  if (classified.kind === 'NEW_ALFA_DOCUMENT_PATH') continue;

  const caso = doc.claimId ? await loadCaso(doc.claimId) : null;
  rows.push({
    tag: 'OLD_ALFA_SHAREPOINT_PATH',
    model: 'ClaimDocument',
    documentId: String(doc._id),
    caseId: doc.claimId ? String(doc.claimId) : null,
    consecutivo: caso?.consecutivo || null,
    identificacion: caso?.identificacion || null,
    numeroPoliza: caso?.numeroPoliza || null,
    documentType: doc.documentType,
    rutaActual: path || null,
    itemId: doc.sharepoint?.itemId || null,
    webUrl: doc.sharepoint?.webUrl || null,
    syncStatus: doc.sharepoint?.syncStatus || null,
    destinationStatus: doc.destinationStatus || null,
    classification: classified,
    rutaNuevaPropuesta: proposeAlfaDocumentPath({
      identificacion: caso?.identificacion,
      numeroPoliza: caso?.numeroPoliza,
      documentType: doc.documentType,
    }),
  });
}

for (const doc of policies) {
  const path = doc.sharepoint?.path || '';
  const classified = classifyAlfaSharePointPath(path);
  if (classified.kind === 'NEW_ALFA_DOCUMENT_PATH') continue;

  const caseId = doc.association?.alfaCaseIds?.[0];
  const caso = caseId ? await loadCaso(caseId) : null;
  const docType = doc.documentType || 'poliza';
  rows.push({
    tag: 'OLD_ALFA_SHAREPOINT_PATH',
    model: 'AlfaPolicyDocument',
    documentId: String(doc._id),
    caseId: caseId ? String(caseId) : null,
    consecutivo: caso?.consecutivo || null,
    identificacion: caso?.identificacion || doc.sourceIdentifier || null,
    numeroPoliza: caso?.numeroPoliza || doc.policyNumber || null,
    documentType: docType,
    rutaActual: path || null,
    itemId: doc.sharepoint?.itemId || null,
    webUrl: doc.sharepoint?.webUrl || null,
    associationStatus: doc.association?.status || null,
    classification: classified,
    rutaNuevaPropuesta: proposeAlfaDocumentPath({
      identificacion: caso?.identificacion || doc.sourceIdentifier,
      numeroPoliza: caso?.numeroPoliza || doc.policyNumber,
      documentType: docType,
    }),
    subfolderPropuesta: getAlfaDocumentSubfolder(docType),
  });
}

console.log('=== OLD_ALFA_SHAREPOINT_PATH INVENTORY (READ-ONLY) ===');
console.log('ClaimDocuments alfa scanned:', claims.length);
console.log('AlfaPolicyDocuments scanned:', policies.length);
console.log('OLD / non-definitive rows:', rows.length);
console.log(JSON.stringify(rows, null, 2));

const bySubtype = {};
for (const r of rows) {
  const k = r.classification?.subtype || r.classification?.kind || 'unknown';
  bySubtype[k] = (bySubtype[k] || 0) + 1;
}
console.log('--- by classification ---');
console.log(bySubtype);
console.log('NO MOVE / NO DELETE — inventory only.');

await mongoose.disconnect();
