/**
 * Revierte municipio inventado (QUIBDÓ) en YOJANIS / Luis Arien
 * y limpia CIUDAD "0" en Herlin / Magnolia. Empuja a SharePoint.
 * Uso: node scripts/revertFdmCiudadesInventadas.js [--apply]
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import EquidadFdmExcelOutboundUpdate from '../models/EquidadFdmExcelOutboundUpdate.js';
import { runEquidadFdmExcelOutboundCycle } from '../services/equidadFdmExcelOutboundService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);
const apply = process.argv.includes('--apply');

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const targets = [
  { consecutivo: 'FDM-2026-08-212', nombre: /yojanis/i, clearTo: null },
  { consecutivo: 'FDM-2026-08-316', nombre: /arien/i, clearTo: null },
  { consecutivo: 'FDM-2026-08-317', nombre: /herlin/i, clearTo: null },
  { consecutivo: 'FDM-2026-08-318', nombre: /magnolia/i, clearTo: null },
];

const found = [];
for (const t of targets) {
  const caso =
    (await EquidadFdmCaso.findOne({ consecutivo: t.consecutivo }).lean()) ||
    (await EquidadFdmCaso.findOne({ nombre: t.nombre, evento: /terremoto/i }).lean());
  if (!caso) {
    found.push({ ...t, missing: true });
    continue;
  }
  found.push({
    _id: caso._id,
    consecutivo: caso.consecutivo,
    nombre: caso.nombre,
    municipioActual: caso.municipio,
    departamentoActual: caso.departamento,
    clearTo: t.clearTo,
  });
}

console.log(JSON.stringify({ dryRun: !apply, found }, null, 2));

if (!apply) {
  await mongoose.disconnect();
  process.exit(0);
}

for (const row of found) {
  if (row.missing) continue;
  const before = {
    municipio: row.municipioActual ?? null,
    departamento: row.departamentoActual ?? null,
  };
  const after = await EquidadFdmCaso.findByIdAndUpdate(
    row._id,
    {
      $set: {
        municipio: null,
        // "0" en Excel no es departamento real
        departamento:
          row.departamentoActual === 0 ||
          row.departamentoActual === '0' ||
          !row.departamentoActual
            ? null
            : row.departamentoActual,
      },
    },
    { new: true }
  ).lean();

  const changes = {
    municipio: { from: before.municipio, to: null },
    departamento: { from: before.departamento, to: after.departamento ?? null },
  };

  const existing = await EquidadFdmExcelOutboundUpdate.findOne({
    casoId: after._id,
    status: 'pending',
  });
  if (existing) {
    existing.changes = { ...(existing.changes || {}), ...changes };
    await existing.save();
  } else {
    await EquidadFdmExcelOutboundUpdate.create({
      casoId: after._id,
      consecutivo: after.consecutivo,
      cedula: after.cedula,
      status: 'pending',
      changes,
    });
  }
  console.log('limpiado', after.consecutivo, after.nombre);
}

const cycle = await runEquidadFdmExcelOutboundCycle({ batchSize: 20 });
console.log('outbound', cycle);

const sin = await EquidadFdmCaso.find({
  evento: /terremoto/i,
  $or: [
    { municipio: null },
    { municipio: '' },
    { municipio: '0' },
    { municipio: /^\s*$/ },
  ],
})
  .select('consecutivo nombre cedula municipio')
  .lean();
console.log('sinCiudadAhora', sin.length, sin.map((c) => c.nombre));

await mongoose.disconnect();
