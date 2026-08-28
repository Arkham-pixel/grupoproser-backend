/**
 * Pausa ClaimDocuments Alfa en cola que NO están ya en CASOS ENVIADOS
 * (evita que el cron siga creando carpetas en SINIESTROS).
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';

await mongoose.connect(process.env.MONGO_URI);

const q = {
  sourceModule: 'alfa',
  status: 'active',
  'sharepoint.enabled': true,
  'sharepoint.syncStatus': { $in: ['pending', 'failed', 'syncing'] },
  $or: [
    { 'sharepoint.path': { $exists: false } },
    { 'sharepoint.path': null },
    { 'sharepoint.path': { $regex: 'SINIESTROS' } },
    { 'sharepoint.path': { $not: /CASOS ENVIADOS A LA ASEGURADORA/ } },
  ],
};

const before = await ClaimDocument.countDocuments(q);
const r = await ClaimDocument.updateMany(q, {
  $set: {
    'sharepoint.enabled': false,
    'sharepoint.syncStatus': 'disabled',
    'sharepoint.nextRetryAt': null,
  },
});

console.log(
  JSON.stringify({
    event: 'PAUSED_SINIESTROS_QUEUE',
    matchedBefore: before,
    matched: r.matchedCount,
    modified: r.modifiedCount,
  })
);

await mongoose.disconnect();
