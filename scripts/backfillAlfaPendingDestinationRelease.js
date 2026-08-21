/**
 * Backfill one-shot: liberar ClaimDocument Alfa que ya tienen cédula numérica
 * pero quedaron en pending_destination (legado path por póliza).
 * También marca ready→pending_destination si el id no es cédula válida.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';
import { buildAlfaSiniestrosDocumentPath } from '../utils/alfaDocumentPath.js';

await mongoose.connect(process.env.MONGO_URI);

const docs = await ClaimDocument.find({
  sourceModule: 'alfa',
  'sharepoint.syncStatus': { $in: ['pending', 'failed'] },
  status: 'active',
}).select(
  'alfaIdentificacion destinationStatus destinationReason documentType sharepoint'
);

let released = 0;
let demoted = 0;

for (const doc of docs) {
  const built = buildAlfaSiniestrosDocumentPath({
    identificacion: doc.alfaIdentificacion,
    documentType: doc.documentType,
  });

  if (built.ok && doc.destinationStatus !== 'ready') {
    doc.destinationStatus = 'ready';
    doc.destinationReason = undefined;
    doc.alfaIdentificacion = built.identificacion;
    if (!doc.sharepoint) doc.sharepoint = {};
    doc.sharepoint.enabled = true;
    if (doc.sharepoint.syncStatus !== 'synced') {
      doc.sharepoint.syncStatus = 'pending';
      doc.sharepoint.nextRetryAt = new Date();
    }
    await doc.save();
    released += 1;
  } else if (!built.ok && doc.destinationStatus === 'ready') {
    doc.destinationStatus = 'pending_destination';
    doc.destinationReason = built.reason || 'MISSING_IDENTIFICATION';
    await doc.save();
    demoted += 1;
  }
}

console.log(JSON.stringify({ released, demoted, scanned: docs.length }));
await mongoose.disconnect();
