/**
 * 1) Elimina duplicados terremoto sin ciudad que ya existen como Lorica (julio).
 * 2) Completa municipio desde oficina (QUIBDÓ) donde aplique.
 * 3) Encola outbound municipio → SharePoint y ejecuta el ciclo.
 *
 * Uso: node scripts/fixFdmCiudadesYPushExcel.js [--apply]
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import EquidadFdmExcelOutboundUpdate from '../models/EquidadFdmExcelOutboundUpdate.js';
import { normalizarMunicipioFdm } from '../utils/fdmExcelParse.js';
import { runEquidadFdmExcelOutboundCycle } from '../services/equidadFdmExcelOutboundService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);
const apply = process.argv.includes('--apply');

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const inferirMunicipioDesdeOficina = (oficina) => {
  const o = String(oficina || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  if (!o) return '';
  if (/\bQUIBDO\b/.test(o)) return 'QUIBDÓ';
  if (/\bCALI\b/.test(o)) return 'CALI';
  if (/\bBUENAVENTURA\b/.test(o)) return 'BUENAVENTURA';
  if (/\bPEREIRA\b/.test(o)) return 'PEREIRA';
  if (/\bLORICA\b/.test(o)) return 'LORICA';
  return '';
};

const sinCiudadTerr = await EquidadFdmCaso.find({
  evento: /terremoto/i,
  $or: [{ municipio: null }, { municipio: '' }, { municipio: /^\s*$/ }],
})
  .select('consecutivo nombre cedula municipio oficinaRadicadora archivos')
  .lean();

const aBorrar = [];
const aCompletar = [];

for (const c of sinCiudadTerr) {
  const ced = String(c.cedula || '').replace(/\D/g, '');
  if (ced) {
    const julio = await EquidadFdmCaso.findOne({
      cedula: c.cedula,
      consecutivo: /^FDM-2026-07/,
      municipio: /lorica/i,
    })
      .select('_id consecutivo municipio')
      .lean();
    if (julio && !(c.archivos && c.archivos.length)) {
      aBorrar.push({ dup: c, keeper: julio });
      continue;
    }
  }
  const inferido = inferirMunicipioDesdeOficina(c.oficinaRadicadora);
  if (inferido) {
    aCompletar.push({ caso: c, municipio: inferido });
  }
}

console.log(
  JSON.stringify(
    {
      dryRun: !apply,
      sinCiudadTerr: sinCiudadTerr.length,
      borrarDuplicadosLorica: aBorrar.length,
      completarDesdeOficina: aCompletar.map((x) => ({
        consecutivo: x.caso.consecutivo,
        nombre: x.caso.nombre,
        municipio: x.municipio,
        oficina: x.caso.oficinaRadicadora,
      })),
      quedanSinCiudad: sinCiudadTerr.length - aBorrar.length - aCompletar.length,
    },
    null,
    2
  )
);

if (!apply) {
  await mongoose.disconnect();
  process.exit(0);
}

let borrados = 0;
for (const { dup } of aBorrar) {
  await EquidadFdmCaso.findByIdAndDelete(dup._id);
  borrados += 1;
}

let actualizados = 0;
const paraOutbound = [];
for (const { caso, municipio } of aCompletar) {
  const before = { municipio: caso.municipio || null };
  const after = await EquidadFdmCaso.findByIdAndUpdate(
    caso._id,
    { $set: { municipio } },
    { new: true }
  ).lean();
  actualizados += 1;
  paraOutbound.push({ before, after });
}

let enqueued = 0;
for (const { before, after } of paraOutbound) {
  const changes = {
    municipio: { from: before.municipio, to: after.municipio },
  };
  const existing = await EquidadFdmExcelOutboundUpdate.findOne({
    casoId: after._id,
    status: 'pending',
  });
  if (existing) {
    existing.changes = { ...(existing.changes || {}), ...changes };
    existing.consecutivo = after.consecutivo;
    existing.cedula = after.cedula;
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
  enqueued += 1;
}

console.log({ borrados, actualizados, enqueued });

const cycle = await runEquidadFdmExcelOutboundCycle({ batchSize: 50 });
console.log('outboundCycle', cycle);

const sinDespues = await EquidadFdmCaso.countDocuments({
  evento: /terremoto/i,
  $or: [{ municipio: null }, { municipio: '' }, { municipio: /^\s*$/ }],
});
console.log('sinCiudadTerremotoDespues', sinDespues);

await mongoose.disconnect();
