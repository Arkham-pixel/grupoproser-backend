/**
 * Actualiza siniestro/caso en ARNALD desde Excel local FDM (solo campos vacíos en ARNALD).
 * Uso: node scripts/actualizarSiniestrosFdmDesdeExcel.js --file "ruta.xlsx" [--apply]
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import { parsearCasosFdmDesdeArchivo } from '../utils/fdmExcelParse.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const fileIdx = args.indexOf('--file');
const file = fileIdx >= 0 ? args[fileIdx + 1] : null;
if (!file) {
  console.error('Indique --file "ruta.xlsx"');
  process.exit(1);
}

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const tieneValor = (v) => {
  const s = String(v ?? '').trim();
  return Boolean(s && s !== '0' && !/^(n\/?a|na|null|-)$/i.test(s));
};

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const { casos } = parsearCasosFdmDesdeArchivo(file, file.split(/[/\\]/).pop());
const filas = casos.filter((f) => tieneValor(f.siniestro));

const allDocs = await EquidadFdmCaso.find({}).select('_id consecutivo nombre cedula caso siniestro').lean();
const byCed = new Map();
const byCaso = new Map();
for (const doc of allDocs) {
  const d = digits(doc.cedula);
  if (d && !byCed.has(d)) byCed.set(d, doc);
  const caso = String(doc.caso ?? '').trim();
  if (caso && !byCaso.has(caso)) byCaso.set(caso, doc);
}

const plan = [];
for (const fila of filas) {
  const d = digits(fila.cedula);
  let doc = d ? byCed.get(d) : null;
  if (!doc && tieneValor(fila.caso)) doc = byCaso.get(String(fila.caso).trim());
  if (!doc) continue;

  const patch = {};
  const sinDb = String(doc.siniestro ?? '').trim();
  const sinExcel = String(fila.siniestro).trim();
  const casoDb = String(doc.caso ?? '').trim();
  const casoExcel = String(fila.caso ?? '').trim();

  if (!tieneValor(sinDb) && tieneValor(sinExcel)) patch.siniestro = sinExcel;
  if (!tieneValor(casoDb) && tieneValor(casoExcel)) patch.caso = casoExcel;
  if (!Object.keys(patch).length) continue;

  plan.push({
    accion: apply ? 'UPDATED' : 'WOULD_UPDATE',
    _id: String(doc._id),
    consecutivo: doc.consecutivo,
    nombre: doc.nombre,
    patch,
  });
}

console.log(JSON.stringify({ apply, file, filasConSiniestro: filas.length, aActualizar: plan.length }, null, 2));
plan.forEach((p) => console.log(JSON.stringify(p)));

if (apply) {
  for (const item of plan) {
    await EquidadFdmCaso.updateOne({ _id: item._id }, { $set: item.patch });
  }
  console.log('ACTUALIZADOS:', plan.length);
}

await mongoose.disconnect();
