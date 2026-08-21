/**
 * Pausa cola SharePoint Alfa: pending/failed → disabled (requiere «Subir» manual).
 * No toca synced ni syncing.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';

await mongoose.connect(process.env.MONGO_URI);

const filter = {
  sourceModule: 'alfa',
  status: 'active',
  'sharepoint.syncStatus': { $in: ['pending', 'failed'] },
  'sharepoint.enabled': true,
};

const result = await ClaimDocument.updateMany(filter, {
  $set: {
    'sharepoint.enabled': false,
    'sharepoint.syncStatus': 'disabled',
    'sharepoint.nextRetryAt': null,
    'sharepoint.lastError': null,
  },
});

console.log(
  JSON.stringify({
    matched: result.matchedCount ?? result.n,
    modified: result.modifiedCount ?? result.nModified,
  })
);

await mongoose.disconnect();
