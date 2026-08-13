import '../config/loadEnv.js';
import mongoose from 'mongoose';
import { listFolder } from '../services/microsoftGraphService.js';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { getAlfaPolicyImportConfig } from '../config/alfaPolicyImport.js';

async function tryList(p) {
  try {
    const r = await listFolder(p, { top: 30 });
    const kids = r.children || [];
    console.log('OK', p, kids.map((c) => `${c.name}${c.folder ? '/' : ''}`));
  } catch (e) {
    console.log('FAIL', p, e.message);
  }
}

const cfg = getAlfaPolicyImportConfig();
console.log('cronEnabled', cfg.cronEnabled);
console.log('rootPath', cfg.rootPath);

await tryList('SEGUROS ALFA');
await tryList('SEGUROS ALFA/PÓLIZAS');
await tryList('SEGUROS ALFA/PÓLIZAS/88187559');
await tryList('SEGUROS ALFA/SINIESTROS');
await tryList('SEGUROS ALFA/SINIESTROS/88187559');

await mongoose.connect(process.env.MONGO_URI);
const docs = await AlfaPolicyDocument.find({
  $or: [
    { sourceIdentifier: '88187559' },
    { 'sharepoint.path': { $regex: '88187559' } },
  ],
}).lean();
console.log('AlfaPolicyDocument count', docs.length);
const caso = await SegurosAlfaCaso.findOne({ identificacion: '88187559' })
  .select('consecutivo archivos numeroPoliza')
  .lean();
console.log('caso', {
  consecutivo: caso?.consecutivo,
  numeroPoliza: caso?.numeroPoliza,
  archivos: (caso?.archivos || []).length,
});
await mongoose.disconnect();
