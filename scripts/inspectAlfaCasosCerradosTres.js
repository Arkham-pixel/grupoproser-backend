import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import ClaimDocument from '../models/ClaimDocument.js';

const CONSECUTIVOS = [
  'ALFA-2026-08-229',
  'ALFA-2026-08-106',
  'ALFA-2026-08-161',
];

await mongoose.connect(process.env.MONGO_URI);

const casos = await SegurosAlfaCaso.find({ consecutivo: { $in: CONSECUTIVOS } })
  .select('consecutivo identificacion asegurado tomador siniestro archivos estado')
  .lean();

for (const c of casos) {
  const archivos = (c.archivos || []).map((a) => ({
    id: String(a._id),
    nombre: a.nombreOriginal,
    etiqueta: a.etiqueta,
    mime: a.tipoMime,
  }));
  const claims = await ClaimDocument.find({
    sourceModule: 'alfa',
    claimId: c._id,
    status: 'active',
  })
    .select('originalName documentType sharepoint.syncStatus sharepoint.enabled alfaIdentificacion storage.key')
    .lean();
  console.log(
    JSON.stringify(
      {
        consecutivo: c.consecutivo,
        identificacion: c.identificacion,
        asegurado: c.asegurado || c.tomador,
        archivos: archivos.length,
        archivosDetalle: archivos,
        claims: claims.map((d) => ({
          name: d.originalName,
          type: d.documentType,
          status: d.sharepoint?.syncStatus,
          enabled: d.sharepoint?.enabled,
          id: d.alfaIdentificacion,
        })),
      },
      null,
      2
    )
  );
}

const missing = CONSECUTIVOS.filter((x) => !casos.some((c) => c.consecutivo === x));
if (missing.length) console.log('MISSING', missing);

await mongoose.disconnect();
