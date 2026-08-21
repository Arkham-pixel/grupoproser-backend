import 'dotenv/config';
import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';

await mongoose.connect(process.env.MONGO_URI);

const pending = await ClaimDocument.find({
  sourceModule: 'alfa',
  'sharepoint.syncStatus': 'pending',
})
  .select('alfaIdentificacion claimId claimNumber destinationStatus originalName documentType')
  .limit(20)
  .lean();

let withAlfaId = 0;
let withCasoId = 0;
let resolvedFromCaso = 0;
for (const d of await ClaimDocument.find({
  sourceModule: 'alfa',
  'sharepoint.syncStatus': 'pending',
})
  .select('alfaIdentificacion claimId destinationStatus')
  .lean()) {
  if (d.alfaIdentificacion) withAlfaId++;
  if (d.claimId) withCasoId++;
}

const sampleIds = pending.slice(0, 5).map((d) => d.claimId).filter(Boolean);
const casos = await SegurosAlfaCaso.find({ _id: { $in: sampleIds } })
  .select('identificacion numeroSiniestro')
  .lean();

console.log({
  withAlfaId,
  withCasoId,
  destStatusSample: pending.map((d) => ({
    name: d.originalName?.slice(0, 40),
    alfaId: d.alfaIdentificacion,
    dest: d.destinationStatus,
    claim: d.claimNumber,
  })),
  casos: casos.map((c) => ({
    id: String(c._id),
    identificacion: c.identificacion,
  })),
});

await mongoose.disconnect();
