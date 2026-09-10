/**
 * Une duplicados Allianz listado: ficha Excel (nombre/ajustador) + ficha huérfana (informe/fotos).
 * APPLY=1 para escribir.
 */
import mongoose from 'mongoose';
import { conectarMongoRobusto } from './_conectarMongoRobusto.js';

const APPLY = process.env.APPLY === '1';
const SOLO = String(process.env.SOLO || '').trim();

const CAMPOS_IDENTIDAD = [
  'asegurado',
  'tomador',
  'ciudad',
  'departamento',
  'numeroPoliza',
  'tipoPoliza',
  'tipoPolizaOtro',
  'direccionPredio',
  'ajustador',
  'ajustadorLider',
  'inspector',
  'identificacion',
  'tipoIdentificacion',
  'correo',
  'celular',
  'correoAsegurado',
  'telefonoAsegurado',
  'intermediario',
  'fechaSiniestro',
  'cobertura',
  'causa',
  'zc',
];

const vacio = (v) =>
  v === undefined || v === null || v === '' || v === 'null' || v === 'undefined';

const claveSiniestro = (d) =>
  String(d.siniestro || d.identificacion || '')
    .replace(/\D/g, '')
    .trim();

function scoreInforme(d) {
  if (Number.isFinite(Number(d.sInf))) return Number(d.sInf);
  const inf = d.informeUnico;
  if (!inf || typeof inf !== 'object') return 0;
  const t = (v) => String(v || '').trim();
  return (
    t(inf.descripcionDanios).length +
    t(inf.conclusiones).length +
    t(inf.recomendacion).length +
    t(inf.analisisCobertura).length +
    t(inf.analisisNexoCausal).length
  );
}

function nArchivos(d) {
  if (Number.isFinite(Number(d.nArchivos))) return Number(d.nArchivos);
  return Array.isArray(d.archivos) ? d.archivos.length : 0;
}

function tieneLiq(d) {
  if (typeof d.tieneLiq === 'boolean') return d.tieneLiq;
  return d.liquidador && typeof d.liquidador === 'object';
}

function tieneAgil(d) {
  if (typeof d.tieneAgil === 'boolean') return d.tieneAgil;
  return d.informeAgil && typeof d.informeAgil === 'object';
}

function esHuerfano(d) {
  return vacio(d.asegurado) || vacio(d.ajustador) || vacio(d.ciudad);
}

function esFichaRica(d) {
  return !vacio(d.asegurado) && (!vacio(d.ciudad) || !vacio(d.ajustador) || !vacio(d.numeroPoliza));
}

const db = await conectarMongoRobusto();
const col = db.collection('gsk3cAppallianzListadoCasos');
const PROY = {
  siniestro: 1,
  identificacion: 1,
  consecutivo: 1,
  createdAt: 1,
  nArchivos: { $cond: [{ $isArray: '$archivos' }, { $size: '$archivos' }, 0] },
  tieneLiq: { $eq: [{ $type: '$liquidador' }, 'object'] },
  tieneAgil: { $eq: [{ $type: '$informeAgil' }, 'object'] },
  sInf: {
    $add: [
      { $strLenCP: { $ifNull: ['$informeUnico.descripcionDanios', ''] } },
      { $strLenCP: { $ifNull: ['$informeUnico.conclusiones', ''] } },
      { $strLenCP: { $ifNull: ['$informeUnico.recomendacion', ''] } },
      { $strLenCP: { $ifNull: ['$informeUnico.analisisCobertura', ''] } },
      { $strLenCP: { $ifNull: ['$informeUnico.analisisNexoCausal', ''] } },
    ],
  },
};
for (const c of CAMPOS_IDENTIDAD) PROY[c] = 1;
const todos = await col.aggregate([{ $project: PROY }], { allowDiskUse: true }).toArray();
console.log(`Fichas leídas (sin blobs): ${todos.length}`);

const porClave = new Map();
for (const d of todos) {
  const k = claveSiniestro(d);
  if (!k || k.length < 6) continue;
  if (SOLO && k !== SOLO.replace(/\D/g, '')) continue;
  if (!porClave.has(k)) porClave.set(k, []);
  porClave.get(k).push(d);
}

const planes = [];
for (const [siniestro, grupo] of porClave) {
  if (grupo.length < 2) continue;
  const fichas = grupo.filter(esFichaRica);
  const conTrabajo = grupo.filter((d) => scoreInforme(d) > 40 || nArchivos(d) > 0 || tieneLiq(d));
  if (!fichas.length) continue;

  const fichaCanon = [...fichas].sort((a, b) => {
    const na = CAMPOS_IDENTIDAD.filter((c) => !vacio(a[c])).length;
    const nb = CAMPOS_IDENTIDAD.filter((c) => !vacio(b[c])).length;
    if (nb !== na) return nb - na;
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  })[0];

  const trabajoCanon = conTrabajo.length
    ? [...conTrabajo].sort((a, b) => {
        const sa = scoreInforme(a) + nArchivos(a) * 10 + (tieneLiq(a) ? 50 : 0);
        const sb = scoreInforme(b) + nArchivos(b) * 10 + (tieneLiq(b) ? 50 : 0);
        return sb - sa;
      })[0]
    : null;

  for (const dest of grupo) {
    const $set = {};
    for (const c of CAMPOS_IDENTIDAD) {
      if (vacio(dest[c]) && !vacio(fichaCanon[c])) $set[c] = fichaCanon[c];
    }
    if (trabajoCanon) {
      if (scoreInforme(dest) <= 40 && scoreInforme(trabajoCanon) > 40) {
        $set._copiarInformeDe = String(trabajoCanon._id);
      }
      if (!tieneLiq(dest) && tieneLiq(trabajoCanon)) {
        $set._copiarLiqDe = String(trabajoCanon._id);
      }
      if (nArchivos(dest) === 0 && nArchivos(trabajoCanon) > 0) {
        $set._copiarArchivosDe = String(trabajoCanon._id);
      }
      if (!tieneAgil(dest) && tieneAgil(trabajoCanon)) {
        $set._copiarAgilDe = String(trabajoCanon._id);
      }
    }
    if (Object.keys($set).length) {
      planes.push({
        siniestro,
        destId: String(dest._id),
        destCons: dest.consecutivo,
        destAseg: dest.asegurado || '—',
        keys: Object.keys($set),
        asegurado: $set.asegurado || dest.asegurado,
        $set,
      });
    }
  }
}

console.log(`Casos listado: ${todos.length}`);
console.log(`Siniestros con 2+ fichas: ${[...porClave.values()].filter((g) => g.length > 1).length}`);
console.log(`Updates: ${planes.length}`);
for (const p of planes) {
  console.log(
    `${p.siniestro} | ${p.destCons} | ${p.destAseg} → ${p.asegurado || p.destAseg} | ${p.keys.join(',')}`
  );
}

if (!APPLY) {
  console.log('\nDRY-RUN. APPLY=1 para escribir.');
  await mongoose.disconnect();
  process.exit(0);
}

const ahora = new Date();
let n = 0;
for (const p of planes) {
  const $set = { ...p.$set };
  const idInf = $set._copiarInformeDe;
  const idLiq = $set._copiarLiqDe;
  const idAgil = $set._copiarAgilDe;
  const idArch = $set._copiarArchivosDe;
  delete $set._copiarInformeDe;
  delete $set._copiarLiqDe;
  delete $set._copiarAgilDe;
  delete $set._copiarArchivosDe;
  const idsFetch = [...new Set([idInf, idLiq, idAgil, idArch].filter(Boolean))];
  const origenes = new Map();
  for (const id of idsFetch) {
    origenes.set(
      id,
      await col.findOne(
        { _id: new mongoose.Types.ObjectId(id) },
        { projection: { informeUnico: 1, liquidador: 1, informeAgil: 1, archivos: 1 } }
      )
    );
  }
  if (idInf && origenes.get(idInf)?.informeUnico) $set.informeUnico = origenes.get(idInf).informeUnico;
  if (idLiq && origenes.get(idLiq)?.liquidador) $set.liquidador = origenes.get(idLiq).liquidador;
  if (idAgil && origenes.get(idAgil)?.informeAgil) $set.informeAgil = origenes.get(idAgil).informeAgil;
  if (idArch && Array.isArray(origenes.get(idArch)?.archivos) && origenes.get(idArch).archivos.length) {
    $set.archivos = origenes.get(idArch).archivos;
  }
  await col.updateOne(
    { _id: new mongoose.Types.ObjectId(p.destId) },
    { $set: { ...$set, updatedAt: ahora } }
  );
  n += 1;
}
console.log(`\nActualizados: ${n}`);
await mongoose.disconnect();
