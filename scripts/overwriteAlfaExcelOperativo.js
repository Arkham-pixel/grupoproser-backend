/**
 * Sobrescribe FAC-Cali.xlsx (operativo) con el consolidado completo local.
 * node scripts/overwriteAlfaExcelOperativo.js
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import {
  downloadDriveItemBuffer,
  getItemMetadata,
  listFolder,
  replaceDriveItemContentBuffer,
  uploadSmallFile,
} from '../services/microsoftGraphService.js';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';

const OPERATIVO = 'CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali.xlsx';
const LOCAL = path.resolve(
  process.env.USERPROFILE || '.',
  'Downloads',
  'CONSOLIDADO-TERREMOTO-AGOSTO-2026-FAC-Cali_COMPLETO.xlsx'
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

await mongoose.connect(process.env.MONGO_URI);
const cfg = getAlfaExcelOutboundConfig();
const folder = cfg.rootPath || 'SEGUROS ALFA/CONTROL Y SEGUIMIENTO';

if (!fs.existsSync(LOCAL)) {
  console.error('No existe copia local:', LOCAL);
  process.exit(1);
}
const buffer = fs.readFileSync(LOCAL);
const localParsed = parseAlfaExcelBuffer(buffer);
console.log('local_rows', localParsed.rows?.length, 'bytes', buffer.length);

const listed = await listFolder(folder, { top: 50 });
console.log(
  'folder_files',
  (listed.children || []).filter((c) => !c.folder).map((c) => c.name)
);
const opItem = (listed.children || []).find((c) => c.name === OPERATIVO);
if (!opItem?.id) {
  console.error('No está el operativo en SharePoint');
  process.exit(1);
}

const far = new Date(Date.now() + 60 * 60 * 1000);
await AlfaExcelOutboundUpdate.updateMany(
  { status: { $in: ['pending', 'processing'] } },
  { $set: { status: 'pending', nextRetryAt: far } }
);

let ok = false;
let lastErr = null;
for (let attempt = 1; attempt <= 15; attempt += 1) {
  try {
    const up = await uploadSmallFile(folder, OPERATIVO, buffer, {
      conflictBehavior: 'replace',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    ok = true;
    console.log('upload_replace_ok', attempt, up?.id);
    break;
  } catch (e) {
    lastErr = e;
    console.warn('upload_fail', attempt, e.code || e.status || '', e.message);
    try {
      const meta = await getItemMetadata(opItem.id);
      await replaceDriveItemContentBuffer({
        driveId: meta.parentReference?.driveId,
        itemId: opItem.id,
        buffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      ok = true;
      console.log('replace_item_ok', attempt);
      break;
    } catch (e2) {
      lastErr = e2;
      console.warn('replace_fail', attempt, e2.code || e2.message);
    }
    await sleep(12000);
  }
}

if (!ok) {
  console.error(
    JSON.stringify({
      ok: false,
      error: lastErr?.code || lastErr?.message,
      hint: 'Cierre FAC-Cali.xlsx en Excel/SharePoint y diga «reintenta».',
    })
  );
  process.exitCode = 1;
  await mongoose.disconnect();
  process.exit(1);
}

const listed2 = await listFolder(folder, { top: 50 });
const op2 = (listed2.children || []).find((c) => c.name === OPERATIVO);
const meta = await getItemMetadata(op2.id);
const verify = await downloadDriveItemBuffer({
  driveId: meta.parentReference?.driveId,
  itemId: op2.id,
});
const rows = parseAlfaExcelBuffer(verify.buffer || verify).rows?.length;

const source = await AlfaExcelSharePointSource.findOne({
  integrationKey: cfg.integrationKey,
});
if (source) {
  source.itemId = op2.id;
  source.fileName = OPERATIVO;
  source.eTag = meta.eTag;
  source.lastArnaldWrittenEtag = meta.eTag;
  source.driveId = meta.parentReference?.driveId;
  await source.save();
}

await AlfaExcelOutboundUpdate.updateMany(
  { status: 'pending' },
  { $set: { nextRetryAt: new Date(), attempts: 0 } }
);

console.log(
  JSON.stringify(
    {
      ok: true,
      fileName: OPERATIVO,
      rows,
      note: 'ARNALD apunta otra vez al archivo original FAC-Cali.xlsx',
    },
    null,
    2
  )
);

await mongoose.disconnect();
