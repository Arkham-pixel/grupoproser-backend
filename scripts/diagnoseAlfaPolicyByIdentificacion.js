/**
 * Diagnóstico: carpeta POLIZAS/88187559 = identificación (solo lectura).
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import { listFolder } from '../services/microsoftGraphService.js';

const FOLDER_ID = '88187559';

function digitsOnly(v) {
  return String(v ?? '').replace(/\D/g, '');
}

await mongoose.connect(process.env.MONGO_URI);

const cases = await SegurosAlfaCaso.find({
  $or: [
    { identificacion: FOLDER_ID },
    { identificacion: { $regex: '88187559' } },
  ],
})
  .select(
    'consecutivo identificacion numeroPoliza numeroCredito siniestro direccionPredio asegurado estado fechaSiniestro'
  )
  .lean();

const byDigits = await SegurosAlfaCaso.find({})
  .select(
    'consecutivo identificacion numeroPoliza numeroCredito siniestro direccionPredio asegurado estado fechaSiniestro'
  )
  .lean();
const matchedNorm = byDigits.filter((c) => digitsOnly(c.identificacion) === FOLDER_ID);

console.log('=== CASOS por identificacion ===');
console.log('query directa count:', cases.length);
console.log('normalizada digits count:', matchedNorm.length);
console.log(
  JSON.stringify(
    matchedNorm.map((c) => ({
      consecutivo: c.consecutivo,
      identificacion: c.identificacion,
      numeroPoliza: c.numeroPoliza,
      numeroCredito: c.numeroCredito,
      siniestro: c.siniestro,
      direccionPredio: c.direccionPredio,
      asegurado: c.asegurado,
      estado: c.estado,
      fechaSiniestro: c.fechaSiniestro,
    })),
    null,
    2
  )
);

console.log('\n=== AlfaPolicyDocument con policyNumber/carpeta 88187559 ===');
const docs = await AlfaPolicyDocument.find({
  $or: [
    { policyNumber: FOLDER_ID },
    { policyNumber: { $regex: '88187559' } },
    { 'sharepoint.path': { $regex: '88187559' } },
    { 'sharePoint.path': { $regex: '88187559' } },
  ],
})
  .limit(20)
  .lean();
console.log('docs count', docs.length);
if (docs[0]) {
  console.log('sample keys', Object.keys(docs[0]));
  console.log(JSON.stringify(docs.slice(0, 5), null, 2));
}

// Schema sample of all policy docs assuming folder=policyNumber
const sampleAssume = await AlfaPolicyDocument.find().sort({ createdAt: -1 }).limit(15).lean();
console.log('\n=== Muestra últimos AlfaPolicyDocument (asumidos) ===');
for (const d of sampleAssume) {
  console.log(
    JSON.stringify({
      _id: String(d._id),
      policyNumber: d.policyNumber,
      association: d.association,
      sharepoint: d.sharepoint || d.sharePoint,
      path: d.path || d.sharePointPath,
      createdAt: d.createdAt,
    })
  );
}

console.log('\n=== SharePoint list SEGUROS ALFA/PÓLIZAS/88187559 ===');
try {
  const listed = await listFolder('SEGUROS ALFA/PÓLIZAS/88187559', { top: 50 });
  const kids = listed.children || listed.value || [];
  console.log(
    'children',
    kids.map((c) => ({
      name: c.name,
      folder: Boolean(c.folder),
      size: c.size,
      id: c.id,
    }))
  );
} catch (e) {
  console.log('listFolder error', e.message);
}

try {
  const root = await listFolder('SEGUROS ALFA/PÓLIZAS', { top: 50 });
  const kids = root.children || root.value || [];
  console.log(
    '\nCarpetas bajo PÓLIZAS (muestra):',
    kids
      .filter((c) => c.folder)
      .slice(0, 25)
      .map((c) => c.name)
  );
  console.log('total hijos', kids.length);
} catch (e) {
  console.log('list PÓLIZAS error', e.message);
}

await mongoose.disconnect();
