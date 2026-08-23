/**
 * Inventario lectura: carpetas SEGUROS ALFA / SINIESTROS + claim docs.
 * node scripts/inventoryAlfaSiniestrosFolders.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import { listFolder } from '../services/microsoftGraphService.js';
import ClaimDocument from '../models/ClaimDocument.js';

await mongoose.connect(process.env.MONGO_URI);

const root = await listFolder('SEGUROS ALFA', { top: 50 });
const rootKids = root.children || [];
console.log('ROOT SEGUROS ALFA:');
for (const c of rootKids) {
  console.log(
    '-',
    c.name,
    c.folder ? 'DIR' : 'FILE',
    'created',
    c.createdDateTime || c.fileSystemInfo?.createdDateTime || null
  );
}

const sin = await listFolder('SEGUROS ALFA/SINIESTROS', { top: 200 });
const sinKids = (sin.children || []).filter((x) => x.folder);
const withDates = sinKids
  .map((c) => ({
    name: c.name,
    created: c.createdDateTime || c.fileSystemInfo?.createdDateTime || null,
    id: c.id,
  }))
  .sort((a, b) => String(a.created).localeCompare(String(b.created)));

console.log('\nSINIESTROS folders:', withDates.length);
console.log(JSON.stringify(withDates, null, 2));

const synced = await ClaimDocument.countDocuments({
  sourceModule: 'alfa',
  'sharepoint.syncStatus': 'synced',
  status: { $ne: 'deleted' },
});
const pending = await ClaimDocument.countDocuments({
  sourceModule: 'alfa',
  'sharepoint.syncStatus': 'pending',
  status: { $ne: 'deleted' },
});
const withPath = await ClaimDocument.countDocuments({
  sourceModule: 'alfa',
  'sharepoint.path': { $regex: '^SEGUROS ALFA/SINIESTROS/' },
  status: { $ne: 'deleted' },
});
console.log(
  JSON.stringify({ synced, pending, withSiniestrosPath: withPath }, null, 2)
);

await mongoose.disconnect();
