import 'dotenv/config';
import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';
import { getSharePointSyncConfig, isSyncModuleEnabled } from '../config/sharepointSync.js';

await mongoose.connect(process.env.MONGO_URI);
const cfg = getSharePointSyncConfig();
console.log(
  JSON.stringify({
    mode: cfg.mode,
    alfaEnabled: isSyncModuleEnabled('alfa'),
    cronEnabled: cfg.cronEnabled,
    forceTestRoot: cfg.forceTestRoot,
  })
);

const all = await ClaimDocument.find({ sourceModule: 'alfa' })
  .select('sharepoint.syncStatus')
  .lean();
const by = {};
for (const d of all) {
  const s = d.sharepoint?.syncStatus || '(none)';
  by[s] = (by[s] || 0) + 1;
}
console.log('claimDocsByStatus', by);

const pending = await ClaimDocument.find({
  sourceModule: 'alfa',
  'sharepoint.syncStatus': { $in: ['pending', 'failed', 'syncing'] },
})
  .select('originalFileName sharepoint identification claimNumber folderKey createdAt')
  .sort({ createdAt: -1 })
  .limit(12)
  .lean();

console.log(
  'pendingSample',
  pending.map((p) => ({
    file: p.originalFileName,
    status: p.sharepoint?.syncStatus,
    path: p.sharepoint?.destinationPath || p.sharepoint?.folderPath,
    id: p.identification,
  }))
);

await mongoose.disconnect();
