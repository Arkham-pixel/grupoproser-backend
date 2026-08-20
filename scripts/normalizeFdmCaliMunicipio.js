/**
 * Unifica municipio SANTIAGO DE CALI → CALI en casos Equidad FDM.
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';

await mongoose.connect(process.env.MONGO_URI);

const antes = await EquidadFdmCaso.aggregate([
  { $match: { municipio: { $regex: /cali|santiago/i } } },
  { $group: { _id: '$municipio', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);

const r1 = await EquidadFdmCaso.updateMany(
  { municipio: { $regex: /^\s*santiago\s+de\s+cali\b/i } },
  { $set: { municipio: 'CALI' } }
);
const r2 = await EquidadFdmCaso.updateMany(
  { municipio: { $regex: /^\s*cali\s*$/i } },
  { $set: { municipio: 'CALI' } }
);

const despues = await EquidadFdmCaso.aggregate([
  { $match: { municipio: { $regex: /cali|santiago/i } } },
  { $group: { _id: '$municipio', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);

console.log(
  JSON.stringify(
    {
      antes,
      updatedSantiago: r1.modifiedCount,
      updatedCaliCase: r2.modifiedCount,
      despues,
    },
    null,
    2
  )
);

await mongoose.disconnect();
