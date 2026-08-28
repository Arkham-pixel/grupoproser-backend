/**
 * Reintenta ClaimDocuments fallidos de un batch de casos enviados.
 * Usa storedName sanitizado si el original tiene acentos problemáticos.
 *
 *   node scripts/retryAlfaCasosEnviadosFailed.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import ClaimDocument from '../models/ClaimDocument.js';
import { syncClaimDocument } from '../services/claimDocumentSyncService.js';

const DESTINO = 'CASOS ENVIADOS A LA ASEGURADORA';
const CONSECUTIVOS = [
  'ALFA-2026-08-11',
];

function sanitizeFileName(name) {
  return String(name || 'archivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.\-()+ ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

await mongoose.connect(process.env.MONGO_URI);
const casos = await SegurosAlfaCaso.find({ consecutivo: { $in: CONSECUTIVOS } })
  .select('_id consecutivo identificacion')
  .lean();

const failed = await ClaimDocument.find({
  sourceModule: 'alfa',
  claimId: { $in: casos.map((c) => c._id) },
  status: 'active',
  'sharepoint.syncStatus': 'failed',
});

console.log(JSON.stringify({ event: 'RETRY_START', count: failed.length }));

const results = [];
for (const doc of failed) {
  const caso = casos.find((c) => String(c._id) === String(doc.claimId));
  const errCode = doc.sharepoint?.lastError?.code;

  // S3 missing: no se puede recuperar sin re-subir al archivero
  if (errCode === 'S3_OBJECT_NOT_FOUND') {
    results.push({
      consecutivo: caso?.consecutivo,
      file: doc.originalName,
      result: 'SKIP_S3_MISSING',
    });
    continue;
  }

  // Reintento SharePoint: nombre sin acentos
  const safe = sanitizeFileName(doc.storedName || doc.originalName);
  if (safe && safe !== doc.storedName) {
    doc.storedName = safe;
  }
  doc.sharepoint.enabled = true;
  doc.sharepoint.syncStatus = 'pending';
  doc.sharepoint.itemId = undefined;
  doc.sharepoint.parentItemId = undefined;
  doc.sharepoint.path = undefined;
  doc.sharepoint.webUrl = undefined;
  doc.sharepoint.syncedAt = undefined;
  doc.sharepoint.lastError = undefined;
  await doc.save();

  const r = await syncClaimDocument(doc._id, { destinationRoot: DESTINO });
  results.push({
    consecutivo: caso?.consecutivo,
    file: doc.originalName,
    storedName: doc.storedName,
    result: r.result,
    path: r.document?.sharepoint?.path,
    error: r.error?.code || r.error?.message,
  });
  console.log(JSON.stringify({ event: 'RETRY_DOC', ...results.at(-1) }));
}

console.log(JSON.stringify({ event: 'RETRY_SUMMARY', results }, null, 2));
await mongoose.disconnect();
