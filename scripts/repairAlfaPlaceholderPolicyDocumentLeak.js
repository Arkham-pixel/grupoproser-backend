/**
 * Quita policyNumber placeholder (POR CONFIRMAR OPERACIONES) de AlfaPolicyDocument.
 * Esos valores hacían que el archivero mostrara cédulas/fotos de un asegurado en todos los casos.
 *
 * Uso:
 *   node scripts/repairAlfaPlaceholderPolicyDocumentLeak.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { isPlaceholderPolicyNumber } from '../utils/alfaIdentification.js';
import { listImportedAlfaPoliciesForCase } from '../services/alfaPolicyImportService.js';

await mongoose.connect(process.env.MONGO_URI);

const docs = await AlfaPolicyDocument.find({
  status: 'active',
  policyNumber: { $nin: [null, ''] },
}).select('originalName sourceIdentifier policyNumber association');

let cleared = 0;
const samples = [];
for (const doc of docs) {
  if (!isPlaceholderPolicyNumber(doc.policyNumber)) continue;
  if (samples.length < 15) {
    samples.push({
      originalName: doc.originalName,
      sourceIdentifier: doc.sourceIdentifier,
      policyNumber: doc.policyNumber,
      matchedBy: doc.association?.matchedBy || null,
      nCases: (doc.association?.alfaCaseIds || []).length,
    });
  }
  doc.policyNumber = null;
  if (doc.association?.matchedBy === 'identificacion_poliza') {
    doc.association.matchedBy = 'identificacion';
  }
  await doc.save();
  cleared += 1;
}

console.log(JSON.stringify({ examined: docs.length, cleared, samples }, null, 2));

const angelica = await SegurosAlfaCaso.findOne({ consecutivo: 'ALFA-2026-08-34' });
const other = await SegurosAlfaCaso.findOne({ consecutivo: 'ALFA-2026-08-234' });
const name = /cedula_Dra/i;

async function namesFor(caso) {
  if (!caso) return { missing: true };
  const listed = await listImportedAlfaPoliciesForCase(caso);
  return {
    consecutivo: caso.consecutivo,
    identificacion: caso.identificacion,
    total: listed.length,
    hasCedulaAngelica: listed.some((d) => name.test(d.originalName)),
    inboundNames: listed.map((d) => d.originalName),
  };
}

console.log('=== ARCHIVERO ALFA-2026-08-34 ===');
console.log(JSON.stringify(await namesFor(angelica), null, 2));
console.log('=== ARCHIVERO ALFA-2026-08-234 ===');
console.log(JSON.stringify(await namesFor(other), null, 2));

await mongoose.disconnect();
