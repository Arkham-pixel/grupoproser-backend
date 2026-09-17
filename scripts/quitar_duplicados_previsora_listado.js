/**
 * Quita duplicados Previsora listado (10 grupos vs Libro1).
 * - Se queda la ficha con más datos de cliente / avance.
 * - Informe, fotos y liquidador de la copia se pasan a la que queda.
 * - Ocobos (LST-08-15) no es copia: se le corrige el siniestro 21734.
 *
 * Uso: node scripts/quitar_duplicados_previsora_listado.js
 */
import mongoose from 'mongoose';
import { conectarMongoRobusto } from './_conectarMongoRobusto.js';

const COL = 'gsk3cAppprevisoraListadoCasos';

const PLANES = [
  {
    nombre: '20887 Moreno Gómez',
    keep: 'PREVISORA-LST-2026-08-84',
    drop: 'PREVISORA-LST-2026-08-262',
    noCaso: '353890',
    siniestro: '20887',
  },
  {
    nombre: '20904 Chujfi Ospina (pasar informe de la copia)',
    keep: 'PREVISORA-LST-2026-08-77',
    drop: 'PREVISORA-LST-2026-08-255',
    noCaso: '353798',
    siniestro: '20904',
  },
  {
    nombre: '21726 Coinca',
    keep: 'PREVISORA-LST-2026-08-237',
    drop: 'PREVISORA-LST-2026-08-24',
    noCaso: '354158',
    siniestro: '21726',
  },
  {
    nombre: '20149 LYSAM',
    keep: 'PREVISORA-LST-2026-08-233',
    drop: 'PREVISORA-LST-2026-08-30',
    noCaso: '354157',
    siniestro: '20149',
  },
  {
    nombre: '21693 Parque Centenario',
    keep: 'PREVISORA-LST-2026-08-258',
    drop: 'PREVISORA-LST-2026-08-72',
    noCaso: '353855',
    siniestro: '21693',
  },
  {
    nombre: '21779 Londoño Carolina',
    keep: 'PREVISORA-LST-2026-08-254',
    drop: 'PREVISORA-LST-2026-08-81',
    noCaso: '353805',
    siniestro: '21779',
  },
  {
    nombre: '21801 Lucy González',
    keep: 'PREVISORA-LST-2026-08-238',
    drop: 'PREVISORA-LST-2026-08-23',
    noCaso: '354156',
    siniestro: '21801',
  },
  {
    nombre: '21803 María Eugenia (tiene asignado Maxwell)',
    keep: 'PREVISORA-LST-2026-08-28',
    drop: 'PREVISORA-LST-2026-08-234',
    noCaso: '354162',
    siniestro: '21803',
  },
  {
    nombre: '24428 Indervalle (pasar asignados, corregir siniestro)',
    keep: 'PREVISORA-LST-2026-08-21',
    drop: 'PREVISORA-LST-2026-08-251',
    noCaso: '354370',
    siniestro: '24428',
  },
];

const CAMPOS_CLIENTE = [
  'asegurado',
  'identificacion',
  'tipoIdentificacion',
  'ciudad',
  'departamento',
  'numeroPoliza',
  'tipoPoliza',
  'direccionPredio',
  'correoAsegurado',
  'telefonoAsegurado',
  'contactoAsegurado',
  'intermediario',
  'correoIntermediario',
  'telefonoIntermediario',
  'contactoIntermediario',
  'ajustador',
  'ajustadorLider',
  'inspector',
  'observaciones',
  'zc',
  'causa',
];

function vacio(v) {
  return v === undefined || v === null || v === '' || v === 'null';
}

function scoreNarrativa(inf) {
  if (!inf || typeof inf !== 'object') return 0;
  return ['descripcionDanios', 'conclusiones', 'recomendacion', 'analisisCobertura', 'analisisNexoCausal']
    .map((k) => String(inf[k] || '').trim().length)
    .reduce((a, b) => a + b, 0);
}

function claveArchivo(a) {
  return String(a?.ruta || a?.nombreArchivo || a?.nombreOriginal || '').trim().toLowerCase();
}

function mergeArchivos(keep = [], drop = []) {
  const out = [...(Array.isArray(keep) ? keep : [])];
  const vistos = new Set(out.map(claveArchivo).filter(Boolean));
  for (const a of Array.isArray(drop) ? drop : []) {
    const k = claveArchivo(a);
    if (k && vistos.has(k)) continue;
    if (k) vistos.add(k);
    const copy = { ...a };
    delete copy._id;
    out.push(copy);
  }
  return out;
}

async function main() {
  const db = await conectarMongoRobusto();
  const col = db.collection(COL);
  const ahora = new Date();
  const resumen = [];

  const ocobos = await col.findOne({ consecutivo: 'PREVISORA-LST-2026-08-15' });
  if (!ocobos) throw new Error('No está LST-08-15 Ocobos');
  await col.updateOne(
    { _id: ocobos._id },
    {
      $set: {
        siniestro: '21734',
        noCaso: '354175',
        updatedAt: ahora,
      },
    }
  );
  resumen.push({
    accion: 'CORREGIR_CLAVE',
    consecutivo: ocobos.consecutivo,
    de: `${ocobos.siniestro}/${ocobos.noCaso}`,
    a: '21734/354175',
    nota: 'Ocobos no era duplicado de López; se le puso el siniestro del Excel',
  });

  for (const p of PLANES) {
    const keep = await col.findOne({ consecutivo: p.keep });
    const drop = await col.findOne({ consecutivo: p.drop });
    if (!keep || !drop) {
      resumen.push({
        accion: 'OMITIDO',
        nombre: p.nombre,
        keep: p.keep,
        drop: p.drop,
        keepOk: Boolean(keep),
        dropOk: Boolean(drop),
      });
      continue;
    }

    const $set = {
      noCaso: p.noCaso,
      siniestro: p.siniestro,
      updatedAt: ahora,
    };
    for (const c of CAMPOS_CLIENTE) {
      if (vacio(keep[c]) && !vacio(drop[c])) $set[c] = drop[c];
    }
    if ((keep.estado === 'CASO NUEVO' || vacio(keep.estado)) && drop.estado && drop.estado !== 'CASO NUEVO') {
      $set.estado = drop.estado;
    }

    const nKeep = Array.isArray(keep.archivos) ? keep.archivos.length : 0;
    const nDrop = Array.isArray(drop.archivos) ? drop.archivos.length : 0;
    let archivosFinal = keep.archivos || [];
    if (nDrop) {
      archivosFinal = mergeArchivos(keep.archivos, drop.archivos);
      $set.archivos = archivosFinal;
    }

    const sKeep = scoreNarrativa(keep.informeUnico);
    const sDrop = scoreNarrativa(drop.informeUnico);
    if (sDrop > sKeep) $set.informeUnico = drop.informeUnico;
    else if (sKeep === 0 && drop.informeUnico && typeof drop.informeUnico === 'object') {
      $set.informeUnico = drop.informeUnico;
    }

    const keepLiq = keep.liquidador && typeof keep.liquidador === 'object';
    const dropLiq = drop.liquidador && typeof drop.liquidador === 'object';
    if (!keepLiq && dropLiq) $set.liquidador = drop.liquidador;

    await col.updateOne({ _id: keep._id }, { $set });
    await col.deleteOne({ _id: drop._id });

    resumen.push({
      accion: 'UNIR_Y_BORRAR',
      nombre: p.nombre,
      queda: keep.consecutivo,
      borrada: drop.consecutivo,
      archivosKeep: nKeep,
      archivosDrop: nDrop,
      archivosFinal: Array.isArray($set.archivos) ? $set.archivos.length : nKeep,
      pasoInforme: Boolean($set.informeUnico),
      pasoLiquidador: Boolean($set.liquidador),
      camposCliente: CAMPOS_CLIENTE.filter((c) => $set[c] !== undefined),
    });
  }

  const total = await col.countDocuments();
  const dupCheck = [];
  for (const p of [...PLANES, { siniestro: '21813', noCaso: '354172' }, { siniestro: '21734', noCaso: '354175' }]) {
    const n = await col.countDocuments({
      $or: [{ siniestro: p.siniestro }, { noCaso: p.noCaso }],
    });
    dupCheck.push({ siniestro: p.siniestro, noCaso: p.noCaso, fichas: n });
  }

  console.log(JSON.stringify({ totalListado: total, resumen, dupCheck }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
