/**
 * Actualiza siniestro (y caso si aplica) en ARNALD desde Excel SharePoint FDM.
 * Solo rellena campos vacíos en ARNALD o corrige si Excel trae valor distinto y ARNALD vacío.
 *
 * Uso: node scripts/actualizarSiniestrosFdmDesdeSharePoint.js [--apply]
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import EquidadFdmExcelSharePointSource from '../models/EquidadFdmExcelSharePointSource.js';
import { getEquidadFdmExcelSharePointConfig } from '../config/equidadFdmExcelSharePoint.js';
import { parsearCasosFdmDesdeBuffer } from '../utils/fdmExcelParse.js';
import {
  downloadDriveItemBuffer,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';
import { runEquidadFdmExcelSharePointDetectCycle } from '../services/equidadFdmExcelSharePointService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const apply = process.argv.includes('--apply');

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const tieneValor = (v) => {
  const s = String(v ?? '').trim();
  return Boolean(s && s !== '0' && !/^(n\/?a|na|null|-)$/i.test(s));
};

function localizar(docMap, fila) {
  const d = digits(fila.cedula);
  if (d && docMap.byCed.has(d)) return docMap.byCed.get(d);
  const caso = String(fila.caso ?? '').trim();
  if (caso && docMap.byCaso.has(caso)) return docMap.byCaso.get(caso);
  const nombre = String(fila.nombre ?? '').trim().toUpperCase();
  if (nombre && docMap.byNombre.has(nombre)) return docMap.byNombre.get(nombre);
  return null;
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const cfg = getEquidadFdmExcelSharePointConfig();
let source = await EquidadFdmExcelSharePointSource.findOne({ integrationKey: cfg.integrationKey });
if (!source?.itemId) {
  await runEquidadFdmExcelSharePointDetectCycle({ force: true });
  source = await EquidadFdmExcelSharePointSource.findOne({ integrationKey: cfg.integrationKey });
}
if (!source?.itemId) {
  console.error('NO_SHAREPOINT_ITEM');
  process.exit(1);
}

const { driveId } = await resolveDriveContext();
const downloaded = await downloadDriveItemBuffer({ driveId: source.driveId || driveId, itemId: source.itemId });
const buffer = downloaded?.buffer || downloaded;
const parsed = parsearCasosFdmDesdeBuffer(buffer, cfg.fileName || 'sharepoint.xlsx');
const filas = (parsed.casos || []).filter((f) => tieneValor(f.siniestro));

const allDocs = await EquidadFdmCaso.find({}).select('_id consecutivo nombre cedula caso siniestro').lean();
const docMap = { byCed: new Map(), byCaso: new Map(), byNombre: new Map() };
for (const doc of allDocs) {
  const d = digits(doc.cedula);
  if (d && !docMap.byCed.has(d)) docMap.byCed.set(d, doc);
  const caso = String(doc.caso ?? '').trim();
  if (caso && !docMap.byCaso.has(caso)) docMap.byCaso.set(caso, doc);
  const nombre = String(doc.nombre ?? '').trim().toUpperCase();
  if (nombre && !docMap.byNombre.has(nombre)) docMap.byNombre.set(nombre, doc);
}

const plan = [];
for (const fila of filas) {
  const doc = localizar(docMap, fila);
  if (!doc) {
    plan.push({ accion: 'SKIP_NO_MATCH', nombre: fila.nombre, cedula: fila.cedula, siniestro: fila.siniestro, caso: fila.caso });
    continue;
  }
  const sinExcel = String(fila.siniestro).trim();
  const sinDb = String(doc.siniestro ?? '').trim();
  const casoExcel = String(fila.caso ?? '').trim();
  const casoDb = String(doc.caso ?? '').trim();
  const patch = {};

  if (!tieneValor(sinDb) && tieneValor(sinExcel)) patch.siniestro = sinExcel;
  else if (tieneValor(sinDb) && sinDb !== sinExcel) {
    plan.push({
      accion: 'SKIP_CONFLICTO',
      consecutivo: doc.consecutivo,
      nombre: doc.nombre,
      siniestroDb: sinDb,
      siniestroExcel: sinExcel,
    });
    continue;
  }

  if (!tieneValor(casoDb) && tieneValor(casoExcel)) patch.caso = casoExcel;

  if (Object.keys(patch).length === 0) continue;

  plan.push({
    accion: apply ? 'UPDATED' : 'WOULD_UPDATE',
    _id: String(doc._id),
    consecutivo: doc.consecutivo,
    nombre: doc.nombre,
    cedula: doc.cedula,
    patch,
    siniestroExcel: sinExcel,
    siniestroAntes: sinDb || null,
  });
}

console.log(JSON.stringify({ apply, filasConSiniestro: filas.length, aActualizar: plan.filter((p) => p.patch).length }, null, 2));
plan.forEach((p) => console.log(JSON.stringify(p)));

if (apply) {
  let updated = 0;
  for (const item of plan) {
    if (!item.patch) continue;
    await EquidadFdmCaso.updateOne({ _id: item._id }, { $set: item.patch });
    updated += 1;
  }
  console.log('ACTUALIZADOS:', updated);
}

await mongoose.disconnect();
