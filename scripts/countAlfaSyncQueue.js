import 'dotenv/config';
import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';

await mongoose.connect(process.env.MONGO_URI);
const readyPending = await ClaimDocument.countDocuments({
  sourceModule: 'alfa',
  status: 'active',
  'sharepoint.syncStatus': 'pending',
  destinationStatus: { $ne: 'pending_destination' },
});
const waitingId = await ClaimDocument.countDocuments({
  sourceModule: 'alfa',
  status: 'active',
  'sharepoint.syncStatus': 'pending',
  destinationStatus: 'pending_destination',
});
const synced = await ClaimDocument.countDocuments({
  sourceModule: 'alfa',
  'sharepoint.syncStatus': 'synced',
});
console.log(JSON.stringify({ readyPending, waitingId, synced }));
await mongoose.disconnect();
