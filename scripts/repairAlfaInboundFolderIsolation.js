/**
 * Audita y repara fugas: ningún documento de carpeta SharePoint {cedula}
 * puede quedar asociado a un caso de otra identificación.
 *
 *   node scripts/repairAlfaInboundFolderIsolation.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  normalizeIdentification,
  inboundFolderMatchesCase,
} from '../utils/alfaIdentification.js';
import { listImportedAlfaPoliciesForCase } from '../services/alfaPolicyImportService.js';

await mongoose.connect(process.env.MONGO_URI);

const docs = await AlfaPolicyDocument.find({ status: 'active' });
const allCases = await SegurosAlfaCaso.find({})
  .select('_id consecutivo identificacion asegurado')
  .lean();
const byId = new Map(allCases.map((c) => [String(c._id), c]));

let repaired = 0;
const leaks = [];

for (const doc of docs) {
  const folderId = normalizeIdentification(doc.sourceIdentifier);
  const kept = [];
  const dropped = [];
  for (const cid of doc.association?.alfaCaseIds || []) {
    const caso = byId.get(String(cid));
    if (caso && inboundFolderMatchesCase(folderId, caso)) {
      kept.push(cid);
    } else {
      dropped.push({
        caseId: String(cid),
        consecutivo: caso?.consecutivo || null,
        identificacion: caso?.identificacion || null,
      });
    }
  }
  if (dropped.length) {
    doc.association.alfaCaseIds = kept;
    if (kept.length === 0) {
      doc.association.status = 'unmatched';
      doc.association.matchedBy = undefined;
    }
    await doc.save();
    repaired += 1;
    leaks.push({
      originalName: doc.originalName,
      folderId,
      dropped,
    });
  }
}

const listingLeaks = [];
for (const caso of allCases) {
  const listed = await listImportedAlfaPoliciesForCase(caso);
  for (const d of listed) {
    if (!inboundFolderMatchesCase(d.sourceIdentifier, caso)) {
      listingLeaks.push({
        consecutivo: caso.consecutivo,
        identificacion: caso.identificacion,
        archivo: d.originalName,
        carpeta: d.sourceIdentifier,
      });
    }
  }
}

const folders = {};
for (const doc of await AlfaPolicyDocument.find({ status: 'active' }).lean()) {
  const id = doc.sourceIdentifier;
  if (!folders[id]) folders[id] = { files: 0, consecutivos: new Set() };
  folders[id].files += 1;
  for (const cid of doc.association?.alfaCaseIds || []) {
    const c = byId.get(String(cid));
    if (c) folders[id].consecutivos.add(c.consecutivo);
  }
}

console.log(
  JSON.stringify(
    {
      docs: docs.length,
      cases: allCases.length,
      repairedAssociations: repaired,
      associationLeaks: leaks,
      listingLeaks,
      folders: Object.fromEntries(
        Object.entries(folders).map(([id, v]) => [
          id,
          { files: v.files, casos: [...v.consecutivos] },
        ])
      ),
      ok: leaks.length === 0 && listingLeaks.length === 0,
    },
    null,
    2
  )
);

if (listingLeaks.length) process.exitCode = 1;
await mongoose.disconnect();
