/**
 * Auditoría outbound + campos caso (solo lectura).
 * node scripts/diagnoseAlfaE2eOutboundFields.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import ClaimDocument from '../models/ClaimDocument.js';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';

await mongoose.connect(process.env.MONGO_URI);

const ids = {
  'ALFA-2026-08-1': '6a7c96aa54984615b6dff255',
  'ALFA-2026-08-10': '6a7c96aa54984615b6dff25e',
};

for (const [label, id] of Object.entries(ids)) {
  const c = await SegurosAlfaCaso.findById(id)
    .select(
      'consecutivo archivos fechaUltimoDocumento reserva valorLiquidado estado correo fechaInspeccion updatedAt'
    )
    .lean();
  console.log('\n===', label, '===');
  console.log(
    JSON.stringify(
      {
        fechaUltimoDocumento: c.fechaUltimoDocumento,
        reserva: c.reserva,
        valorLiquidado: c.valorLiquidado,
        estado: c.estado,
        correo: c.correo,
        fechaInspeccion: c.fechaInspeccion,
        archivos: (c.archivos || []).map((a) => ({
          id: String(a._id),
          name: a.nombreOriginal,
          et: a.etiqueta,
          fecha: a.fechaSubida,
        })),
      },
      null,
      2
    )
  );

  const outs = await AlfaExcelOutboundUpdate.find({ caseId: id })
    .sort({ createdAt: -1 })
    .limit(40)
    .lean();
  console.log('outbound count', outs.length);
  for (const o of outs) {
    const chRaw = o.changes;
    const ch =
      chRaw && typeof chRaw === 'object' && !(chRaw instanceof Map)
        ? chRaw
        : chRaw instanceof Map
          ? Object.fromEntries(chRaw)
          : {};
    // mongoose Map lean often becomes plain object already
    const fields = Object.keys(ch || {});
    const changes = {};
    for (const f of fields) {
      changes[f] = {
        before: ch[f]?.before,
        after: ch[f]?.after,
        column: ch[f]?.column,
      };
    }
    console.log(
      JSON.stringify(
        {
          id: String(o._id),
          status: o.status,
          createdAt: o.createdAt,
          fields,
          changes,
          eTagBefore: o.sourceExcel?.eTagBefore || null,
          eTagAfter: o.sourceExcel?.eTagAfter || null,
          columnsWritten: o.sourceExcel?.columnsWritten || [],
        },
        null,
        2
      )
    );
  }
}

const extraClaims = await ClaimDocument.find({
  sourceModule: 'alfa',
  $or: [
    { originalName: /e2e|prueba|TEST-ARNALD|validacion/i },
    { claimNumber: /TEST-ARNALD|E2E-PEND/i },
    { 'storage.key': /test\/sharepoint|\/e2e\//i },
  ],
})
  .select('claimNumber originalName status sharepoint.path storage.key')
  .lean();
console.log('\nextra claims', extraClaims.length);

const claims10 = await ClaimDocument.find({
  claimId: ids['ALFA-2026-08-10'],
  status: { $ne: 'deleted' },
})
  .select('originalName documentType sharepoint.path storage.key createdAt')
  .lean();
console.log('\nclaims ALFA-2026-08-10', JSON.stringify(claims10, null, 2));

const allOutTestish = await AlfaExcelOutboundUpdate.find({
  $or: [
    { consecutivo: /E2E|TEST/i },
    { 'changes.correo.after': /validacion\.monitor|@arnald\.test/i },
  ],
})
  .limit(20)
  .lean();
console.log('\noutbound testish', allOutTestish.length);

await mongoose.disconnect();
