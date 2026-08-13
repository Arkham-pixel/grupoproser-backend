/**
 * Ciclo manual único: importa pólizas desde PÓLIZAS + SINIESTROS/{identificacion}.
 * No activa cron. No crea carpetas en SharePoint.
 *
 *   node scripts/runAlfaPolicyImportOnce.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import { runAlfaPolicyImportCycle } from '../services/alfaPolicyImportService.js';
import { getAlfaPolicyImportConfig } from '../config/alfaPolicyImport.js';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';

const cfg = getAlfaPolicyImportConfig();
console.log('cronEnabled', cfg.cronEnabled);
console.log('rootPath', cfg.rootPath);

await mongoose.connect(process.env.MONGO_URI);
const summary = await runAlfaPolicyImportCycle({ batchSize: 50 });
console.log(JSON.stringify(summary, null, 2));

const docs = await AlfaPolicyDocument.find({ sourceIdentifier: '88187559' }).lean();
console.log(
  'docs 88187559',
  docs.map((d) => ({
    id: String(d._id),
    status: d.association?.status,
    cases: (d.association?.alfaCaseIds || []).map(String),
    policyNumber: d.policyNumber,
    path: d.sharepoint?.path,
    s3: d.storage?.key,
    name: d.originalName,
  }))
);

await mongoose.disconnect();
