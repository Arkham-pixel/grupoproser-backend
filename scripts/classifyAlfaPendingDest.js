import 'dotenv/config';
import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';
import { buildAlfaSiniestrosDocumentPath } from '../utils/alfaDocumentPath.js';

await mongoose.connect(process.env.MONGO_URI);

const pending = await ClaimDocument.find({
  sourceModule: 'alfa',
  'sharepoint.syncStatus': 'pending',
})
  .select('alfaIdentificacion destinationStatus documentType originalName claimNumber')
  .lean();

let readyOk = 0;
let readyBadId = 0;
let pendButOk = 0;
let pendBad = 0;
const badSamples = [];
const stuckSamples = [];

for (const d of pending) {
  const built = buildAlfaSiniestrosDocumentPath({
    identificacion: d.alfaIdentificacion,
    documentType: d.documentType,
  });
  if (d.destinationStatus === 'ready') {
    if (built.ok) readyOk++;
    else {
      readyBadId++;
      if (badSamples.length < 5) {
        badSamples.push({ id: d.alfaIdentificacion, reason: built.reason, name: d.originalName });
      }
    }
  } else {
    if (built.ok) {
      pendButOk++;
      if (stuckSamples.length < 5) {
        stuckSamples.push({
          id: d.alfaIdentificacion,
          path: built.path,
          dest: d.destinationStatus,
        });
      }
    } else pendBad++;
  }
}

console.log({
  total: pending.length,
  readyOk,
  readyBadId,
  pendButOk,
  pendBad,
  badSamples,
  stuckSamples,
});

await mongoose.disconnect();
