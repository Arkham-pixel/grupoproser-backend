import 'dotenv/config';
import mongoose from 'mongoose';
import { runSharePointSyncCycle } from '../workers/sharepointSyncWorker.js';
import { getSharePointSyncConfig, isSyncModuleEnabled } from '../config/sharepointSync.js';
import ClaimDocument from '../models/ClaimDocument.js';

await mongoose.connect(process.env.MONGO_URI);
const cfg = getSharePointSyncConfig();
console.log(
  JSON.stringify({
    alfaEnabled: isSyncModuleEnabled('alfa'),
    mode: cfg.mode,
    forceTestRoot: cfg.forceTestRoot,
  })
);

const before = await ClaimDocument.aggregate([
  { $match: { sourceModule: 'alfa' } },
  { $group: { _id: '$sharepoint.syncStatus', n: { $sum: 1 } } },
]);
console.log('before', before);

const result = await runSharePointSyncCycle({ batchSize: 3, concurrency: 1 });
console.log('cycle', JSON.stringify(result, null, 2));

const after = await ClaimDocument.aggregate([
  { $match: { sourceModule: 'alfa' } },
  { $group: { _id: '$sharepoint.syncStatus', n: { $sum: 1 } } },
]);
console.log('after', after);

const synced = await ClaimDocument.find({
  sourceModule: 'alfa',
  'sharepoint.syncStatus': 'synced',
  'sharepoint.syncedAt': { $gte: new Date(Date.now() - 10 * 60 * 1000) },
})
  .select('originalName alfaIdentificacion sharepoint.path claimNumber')
  .sort({ 'sharepoint.syncedAt': -1 })
  .limit(5)
  .lean();
console.log(
  'recentSynced',
  synced.map((d) => ({
    name: d.originalName,
    path: d.sharepoint?.path,
    id: d.alfaIdentificacion,
  }))
);

await mongoose.disconnect();
