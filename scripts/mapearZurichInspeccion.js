/**
 * Mapeo de casos Zurich CAT vs listado. Solo lectura.
 * Uso: node scripts/mapearZurichInspeccion.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const aplicaRespondido = (valor) =>
  valor === 'SI' || valor === 'NO' || valor === true || valor === false;

const normNiveles = (raw = {}, legacy = null) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (let n = 1; n <= 6; n += 1) {
    const item = src[`nivel${n}`] || src[String(n)] || src[n] || {};
    out[n] = item?.aplica;
  }
  if (!Object.values(out).some(aplicaRespondido) && Number(legacy) >= 1 && Number(legacy) <= 6) {
    out[Number(legacy)] = 'SI';
  }
  return out;
};

const checklistLleno = (doc) => {
  if (doc.checklistCatCompleto === true) return true;
  const n = normNiveles(doc.severidadCatNiveles, doc.severidadCat);
  return [1, 2, 3, 4, 5, 6].every((i) => aplicaRespondido(n[i]));
};

const tieneEvidencia = (doc) => {
  const ev = doc.evidenciaCat || {};
  return ['fotoGeneral', 'fotoDanos', 'equiposCriticos', 'mitigacion', 'noAcceso'].some((k) => {
    const v = ev[k];
    if (!v) return false;
    if (v === true) return true;
    return aplicaRespondido(v.aplica);
  });
};

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;
const cat = db.collection('gsk3cAppzurichCasos');
const listado = db.collection('gsk3cAppzurichListadoCasos');

const catDocs = await cat.find({}).project({
  consecutivo: 1,
  zc: 1,
  siniestro: 1,
  identificacion: 1,
  asegurado: 1,
  ciudad: 1,
  estado: 1,
  inspector: 1,
  ajustador: 1,
  fechaInspeccion: 1,
  observacionesCat: 1,
  severidadCat: 1,
  severidadCatNiveles: 1,
  evidenciaCat: 1,
  checklistCatCompleto: 1,
  archivos: 1,
  expressCasoId: 1,
  canalRadicacion: 1,
  createdAt: 1,
  updatedAt: 1,
}).toArray();

const listDocs = await listado.find({}).project({
  consecutivo: 1, zc: 1, siniestro: 1, asegurado: 1, createdAt: 1,
}).toArray();

const conChecklist = catDocs.filter(checklistLleno);
const conFechaInsp = catDocs.filter((d) => d.fechaInspeccion);
const conObsCat = catDocs.filter((d) => String(d.observacionesCat || '').trim());
const conEvidencia = catDocs.filter(tieneEvidencia);
const conFotos = catDocs.filter((d) => Array.isArray(d.archivos) && d.archivos.length > 0);
const deExpress = catDocs.filter((d) => d.expressCasoId || String(d.canalRadicacion || '').toUpperCase() === 'EXPRESS');
const inspeccionParcial = catDocs.filter((d) => {
  const n = normNiveles(d.severidadCatNiveles, d.severidadCat);
  const alguno = Object.values(n).some(aplicaRespondido);
  return alguno && !checklistLleno(d);
});

const porDiaAlta = {};
for (const d of catDocs) {
  const dia = d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : 'sin-fecha';
  porDiaAlta[dia] = (porDiaAlta[dia] || 0) + 1;
}

const porDiaUpdate = {};
for (const d of catDocs) {
  const dia = d.updatedAt ? new Date(d.updatedAt).toISOString().slice(0, 10) : 'sin-fecha';
  porDiaUpdate[dia] = (porDiaUpdate[dia] || 0) + 1;
}

const huecosConsecutivo = [];
const nums = catDocs
  .map((d) => String(d.consecutivo || '').match(/^ZURICH-(\d{4})-(\d{2})-(\d+)$/i))
  .filter(Boolean)
  .map((m) => ({ y: m[1], m: m[2], n: Number(m[3]), raw: m[0] }));
const grupos = new Map();
for (const x of nums) {
  const k = `${x.y}-${x.m}`;
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push(x.n);
}
for (const [k, arr] of grupos) {
  const set = new Set(arr);
  const max = Math.max(...arr);
  const min = Math.min(...arr);
  const missing = [];
  for (let i = min; i <= max; i += 1) if (!set.has(i)) missing.push(`ZURICH-${k}-${i}`);
  if (missing.length) huecosConsecutivo.push({ periodo: k, min, max, total: arr.length, faltantes: missing });
}

const zcListado = new Set(listDocs.map((d) => String(d.zc || '').trim().toUpperCase()).filter(Boolean));
const zcCat = new Set(catDocs.map((d) => String(d.zc || '').trim().toUpperCase()).filter(Boolean));
const cruzados = [...zcCat].filter((z) => zcListado.has(z));

const inspeccionados = catDocs
  .filter((d) => checklistLleno(d) || d.fechaInspeccion || conObsCat.includes(d) || tieneEvidencia(d) || (d.archivos || []).length)
  .map((d) => ({
    consecutivo: d.consecutivo,
    asegurado: d.asegurado,
    ciudad: d.ciudad,
    inspector: d.inspector,
    fechaInspeccion: d.fechaInspeccion,
    checklist: checklistLleno(d),
    fotos: (d.archivos || []).length,
    updatedAt: d.updatedAt,
  }))
  .sort((a, b) => String(a.consecutivo).localeCompare(String(b.consecutivo), 'es'));

const out = {
  generado: new Date().toISOString(),
  cat: {
    total: catDocs.length,
    checklistCompleto: conChecklist.length,
    conFechaInspeccion: conFechaInsp.length,
    conObservacionesCat: conObsCat.length,
    conEvidencia: conEvidencia.length,
    conArchivos: conFotos.length,
    inspeccionParcial: inspeccionParcial.length,
    origenExpress: deExpress.length,
    altaPorDia: porDiaAlta,
    updatePorDia: porDiaUpdate,
    huecosConsecutivo,
  },
  listado: {
    total: listDocs.length,
    zcEnComunConCat: cruzados.length,
  },
  inspeccionados,
};

console.log(JSON.stringify(out, null, 2));
await mongoose.disconnect();
