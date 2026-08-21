import 'dotenv/config';
import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';

await mongoose.connect(process.env.MONGO_URI);
const p = await ClaimDocument.findOne({
  sourceModule: 'alfa',
  'sharepoint.syncStatus': 'pending',
}).lean();
console.log('sampleKeys', p ? Object.keys(p) : null);
console.log(
  'sample',
  JSON.stringify(
    {
      _id: p?._id,
      fileName: p?.fileName,
      originalName: p?.originalName,
      documentType: p?.documentType,
      claimNumber: p?.claimNumber,
      identification: p?.identification,
      folderKey: p?.folderKey,
      sharepoint: p?.sharepoint,
      s3: p?.s3 ? { bucket: p.s3.bucket, key: p.s3.key } : null,
    },
    null,
    2
  )
);

const withId = await ClaimDocument.countDocuments({
  sourceModule: 'alfa',
  'sharepoint.syncStatus': 'pending',
  identification: { $nin: [null, ''] },
});
const noId = await ClaimDocument.countDocuments({
  sourceModule: 'alfa',
  'sharepoint.syncStatus': 'pending',
  $or: [
    { identification: null },
    { identification: '' },
    { identification: { $exists: false } },
  ],
});
const dest = await ClaimDocument.aggregate([
  { $match: { sourceModule: 'alfa', 'sharepoint.syncStatus': 'pending' } },
  { $group: { _id: '$sharepoint.destinationStatus', n: { $sum: 1 } } },
]);
console.log({ withId, noId, dest });
await mongoose.disconnect();
