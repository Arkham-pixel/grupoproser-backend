import 'dotenv/config';
import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';

await mongoose.connect(process.env.MONGO_URI);
const rows = await ClaimDocument.find({
  sourceModule: 'alfa',
  $or: [
    { documentType: { $in: ['informe', 'liquidacion'] } },
    { originalName: /informe|xlsx|excel|cat|liquid/i },
  ],
})
  .select(
    'originalName documentType sharepoint.path sharepoint.syncStatus destinationStatus alfaIdentificacion createdAt mimeType'
  )
  .sort({ createdAt: -1 })
  .limit(25)
  .lean();

console.log(
  JSON.stringify(
    rows.map((r) => ({
      name: r.originalName,
      type: r.documentType,
      mime: r.mimeType,
      status: r.sharepoint?.syncStatus,
      path: r.sharepoint?.path,
      dest: r.destinationStatus,
      id: r.alfaIdentificacion,
      at: r.createdAt,
    })),
    null,
    2
  )
);
await mongoose.disconnect();
