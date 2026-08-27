/**
 * Limpia siniestro/caso mal asignados en duplicados FDM.
 * Regla: el caso con liquidador (o LIQUIDADO + archivos) conserva estado y siniestro;
 * el gemelo vacío/PENDIENTE pierde el siniestro (y caso si está compartido indebidamente).
 *
 * Uso: node scripts/limpiarSiniestrosDuplicadosFdm.js [--apply]
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';

const apply = process.argv.includes('--apply');

const tieneValor = (v) => {
  const s = String(v ?? '').trim();
  return Boolean(s && s !== '0' && !/^(n\/?a|na|null|-)$/i.test(s));
};

const digits = (v) => String(v ?? '').replace(/\D/g, '');

function tieneLiquidador(caso) {
  const liq = caso?.liquidador;
  if (!liq) return false;
  if (typeof liq === 'object') {
    if (Object.keys(liq).length === 0) return false;
    // señales típicas de liquidador usado
    if (liq.encabezado || liq.filas || liq.items || liq.totalLiquidado != null) return true;
    return JSON.stringify(liq).length > 20;
  }
  return String(liq).trim().length > 0;
}

function scoreKeeper(caso) {
  let s = 0;
  if (tieneLiquidador(caso)) s += 100;
  const est = String(caso.estado || '').toUpperCase();
  if (est.includes('LIQUID') || est.includes('GIRADO')) s += 50;
  if ((caso.archivos || []).length > 0) s += 20;
  if (tieneValor(caso.siniestro)) s += 5;
  if (tieneValor(caso.polizaAfectar)) s += 3;
  if (tieneValor(caso.municipio)) s += 2;
  return s;
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const todos = await EquidadFdmCaso.find({ esNuevo: true }).lean();
const conSin = todos.filter((c) => tieneValor(c.siniestro));

// Agrupar por número de siniestro
const bySin = new Map();
for (const c of conSin) {
  const s = String(c.siniestro).trim();
  if (!bySin.has(s)) bySin.set(s, []);
  bySin.get(s).push(c);
}

const plan = [];

for (const [siniestro, group] of bySin) {
  if (group.length < 2) continue;

  const ranked = [...group].sort((a, b) => scoreKeeper(b) - scoreKeeper(a));
  const keeper = ranked[0];
  const losers = ranked.slice(1);

  // Si nadie tiene liquidador/liquidado, no tocar sin revisión
  if (scoreKeeper(keeper) < 50) {
    plan.push({
      accion: 'SKIP_SIN_LIQUIDADOR',
      siniestro,
      casos: group.map((c) => c.consecutivo),
    });
    continue;
  }

  for (const loser of losers) {
    const patch = {};
    // Siempre quitar siniestro del no-keeper
    if (tieneValor(loser.siniestro)) patch.siniestro = null;

    // Si comparten el mismo número de caso, quitarlo del loser (pertenece al liquidado)
    if (tieneValor(loser.caso) && String(loser.caso).trim() === String(keeper.caso || '').trim()) {
      patch.caso = null;
    }

    // Misma cédula = duplicado de persona: no bajar estado del liquidado; el vacío queda PENDIENTE sin siniestro
    const mismaPersona = digits(loser.cedula) && digits(loser.cedula) === digits(keeper.cedula);

    plan.push({
      accion: apply ? 'CLEAN' : 'WOULD_CLEAN',
      siniestro,
      keeper: {
        consecutivo: keeper.consecutivo,
        nombre: keeper.nombre,
        estado: keeper.estado,
        score: scoreKeeper(keeper),
        archivos: (keeper.archivos || []).length,
        liquidador: tieneLiquidador(keeper),
      },
      loser: {
        _id: String(loser._id),
        consecutivo: loser.consecutivo,
        nombre: loser.nombre,
        estado: loser.estado,
        cedula: loser.cedula,
        casoAntes: loser.caso,
        siniestroAntes: loser.siniestro,
        mismaPersona,
        score: scoreKeeper(loser),
      },
      patch,
    });
  }
}

console.log(
  JSON.stringify(
    {
      apply,
      duplicadosSiniestro: [...bySin.values()].filter((g) => g.length > 1).length,
      aLimpiar: plan.filter((p) => p.patch).length,
      skip: plan.filter((p) => p.accion === 'SKIP_SIN_LIQUIDADOR').length,
    },
    null,
    2
  )
);
plan.forEach((p) => console.log(JSON.stringify(p)));

if (apply) {
  let n = 0;
  for (const item of plan) {
    if (!item.patch || !item.loser?._id) continue;
    await EquidadFdmCaso.updateOne({ _id: item.loser._id }, { $set: item.patch });
    n += 1;
  }
  console.log('LIMPIADOS:', n);

  const nuevos = await EquidadFdmCaso.find({ esNuevo: true }).select('siniestro').lean();
  const con = nuevos.filter((c) => tieneValor(c.siniestro)).length;
  console.log('Dashboard con siniestro ahora:', con, 'de', nuevos.length);
}

await mongoose.disconnect();
