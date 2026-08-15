/**
 * Vacía Evaluación y Dictamen NSR-10 ya diligenciados (conserva Portada y Presupuesto).
 *
 *   node scripts/limpiarEvaluacionDictamenNsr10.js
 *   node scripts/limpiarEvaluacionDictamenNsr10.js --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import HistorialFormulario from '../models/HistorialFormulario.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import SegurosSuraCaso from '../models/SegurosSuraCaso.js';
import ZurichCaso from '../models/ZurichCaso.js';

const APPLY = process.argv.includes('--apply');

function itemTieneRespuesta(it) {
  if (!it || typeof it !== 'object') return false;
  return Boolean(
    String(it.estado || '').trim() ||
      String(it.observacion || '').trim() ||
      String(it.fotoRef || '').trim() ||
      String(it.fotoArchivoId || '').trim() ||
      String(it.fotoRuta || '').trim() ||
      String(it.accionSugerida || '').trim() ||
      (it.puntaje != null && it.puntaje !== '')
  );
}

function hojaVisible(hojaActiva) {
  const id = String(hojaActiva || '').trim();
  if (id === 'presupuesto') return 'presupuesto';
  return 'portada';
}

function necesitaLimpieza(evalData) {
  if (!evalData || typeof evalData !== 'object') return false;
  if (evalData.criterioFinal) return true;
  const hoja = String(evalData.hojaActiva || '');
  if (hoja === 'evaluacion' || hoja === 'dictamen' || hoja === 'listas') return true;
  const items = Array.isArray(evalData.items) ? evalData.items : [];
  return items.some(itemTieneRespuesta);
}

function payloadLimpieza(evalData, prefix) {
  return {
    [`${prefix}.items`]: [],
    [`${prefix}.criterioFinal`]: null,
    [`${prefix}.hojaActiva`]: hojaVisible(evalData?.hojaActiva),
  };
}

async function limpiarCasos(Model, etiqueta) {
  const docs = await Model.find({
    'liquidador.evaluacionSismicaNSR10': { $exists: true, $ne: null },
  })
    .select({ _id: 1, liquidador: 1 })
    .lean();

  let candidatos = 0;
  let actualizados = 0;
  for (const doc of docs) {
    const evalData = doc.liquidador?.evaluacionSismicaNSR10;
    if (!necesitaLimpieza(evalData)) continue;
    candidatos += 1;
    if (!APPLY) continue;
    const res = await Model.updateOne(
      { _id: doc._id },
      { $set: payloadLimpieza(evalData, 'liquidador.evaluacionSismicaNSR10') }
    );
    if (res.modifiedCount) actualizados += 1;
  }
  return { etiqueta, revisados: docs.length, candidatos, actualizados };
}

async function limpiarHistorial() {
  const docs = await HistorialFormulario.find({
    tipo: { $in: ['catastrofico', 'evaluacion_sismica_nsr10'] },
    'datos.evaluacionSismicaNSR10': { $exists: true, $ne: null },
  })
    .select({ _id: 1, tipo: 1, datos: 1 })
    .lean();

  let candidatos = 0;
  let actualizados = 0;
  for (const doc of docs) {
    const evalData = doc.datos?.evaluacionSismicaNSR10;
    if (!necesitaLimpieza(evalData)) continue;
    candidatos += 1;
    if (!APPLY) continue;
    const res = await HistorialFormulario.updateOne(
      { _id: doc._id },
      { $set: payloadLimpieza(evalData, 'datos.evaluacionSismicaNSR10') }
    );
    if (res.modifiedCount) actualizados += 1;
  }
  return {
    etiqueta: 'historial catastrófico / NSR-10',
    revisados: docs.length,
    candidatos,
    actualizados,
  };
}

async function main() {
  const uri =
    process.env.MONGO_URI_DIRECT ||
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.DB_URI;
  if (!uri) {
    console.error('Falta MONGO_URI / MONGODB_URI');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log(APPLY ? 'MODO APPLY: se vaciarán Evaluación y Dictamen' : 'MODO DRY-RUN (pasar --apply para escribir)');

  const resultados = [
    await limpiarCasos(ZurichCaso, 'Zurich'),
    await limpiarCasos(SegurosAlfaCaso, 'Alfa'),
    await limpiarCasos(SegurosSuraCaso, 'Sura'),
    await limpiarHistorial(),
  ];

  for (const r of resultados) {
    console.log(
      `${r.etiqueta}: revisados=${r.revisados} con datos=${r.candidatos}${
        APPLY ? ` actualizados=${r.actualizados}` : ''
      }`
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
