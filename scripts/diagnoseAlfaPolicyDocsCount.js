import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';

await mongoose.connect(process.env.MONGO_URI);
const total = await AlfaPolicyDocument.countDocuments();
const byPol = await AlfaPolicyDocument.aggregate([
  { $group: { _id: '$policyNumber', n: { $sum: 1 }, statuses: { $addToSet: '$association.status' } } },
  { $sort: { n: -1 } },
  { $limit: 40 },
]);
console.log('total AlfaPolicyDocument', total);
console.log(JSON.stringify(byPol, null, 2));
const look = await AlfaPolicyDocument.find({ policyNumber: '88187559' }).lean();
console.log('as policyNumber 88187559', look.length);
await mongoose.disconnect();
