/**
 * Diagnóstico SOLO LECTURA — calidad datos Seguros Alfa existentes.
 * No modifica Mongo.
 * Uso: node scripts/diagnoseAlfaExcelIncremental.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelImport from '../models/AlfaExcelImport.js';

function norm(v) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}
function normPol(v) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, '');
}
function hasVal(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

await mongoose.connect(process.env.MONGO_URI);

const all = await SegurosAlfaCaso.find()
  .select(
    'consecutivo siniestro identificacion numeroPoliza numeroCredito asegurado tomador ajustador correo estado direccionPredio fechaSiniestro fechaInicioPoliza fechaFinPoliza informacionContacto canalRadicacion ciudad departamento valorReclamado valorLiquidado reserva cobertura estadoPagoPrimas createdAt updatedAt archivos liquidador informeUnico'
  )
  .lean();

const total = all.length;
const conSiniestro = all.filter((c) => hasVal(c.siniestro)).length;
const conPoliza = all.filter((c) => hasVal(c.numeroPoliza)).length;
const conId = all.filter((c) => hasVal(c.identificacion)).length;
const conCredito = all.filter((c) => hasVal(c.numeroCredito)).length;
const conConsecutivo = all.filter((c) => hasVal(c.consecutivo)).length;
const conArchivos = all.filter((c) => Array.isArray(c.archivos) && c.archivos.length > 0).length;
const conLiquidador = all.filter((c) => c.liquidador != null).length;
const conInforme = all.filter((c) => c.informeUnico != null).length;

const byEstado = {};
for (const c of all) {
  const e = c.estado || '(vacío)';
  byEstado[e] = (byEstado[e] || 0) + 1;
}

const fields = [
  'siniestro',
  'identificacion',
  'asegurado',
  'tomador',
  'ajustador',
  'numeroPoliza',
  'direccionPredio',
  'numeroCredito',
  'informacionContacto',
  'correo',
  'canalRadicacion',
  'ciudad',
  'departamento',
  'fechaSiniestro',
  'fechaInicioPoliza',
  'fechaFinPoliza',
  'estado',
  'valorReclamado',
  'valorLiquidado',
  'reserva',
  'cobertura',
  'estadoPagoPrimas',
];
const filled = {};
for (const f of fields) {
  filled[f] = all.filter((c) => hasVal(c[f])).length;
}

const bySin = new Map();
const byPol = new Map();
const byIdPol = new Map();
const byId = new Map();
for (const c of all) {
  const s = norm(c.siniestro);
  const p = normPol(c.numeroPoliza);
  const id = norm(c.identificacion);
  if (s) {
    if (!bySin.has(s)) bySin.set(s, []);
    bySin.get(s).push(c);
  }
  if (p) {
    if (!byPol.has(p)) byPol.set(p, []);
    byPol.get(p).push(c);
  }
  if (id && p) {
    const k = `${id}|${p}`;
    if (!byIdPol.has(k)) byIdPol.set(k, []);
    byIdPol.get(k).push(c);
  }
  if (id) {
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(c);
  }
}

const siniestrosDup = [...bySin.entries()].filter(([, a]) => a.length > 1);
const polizasMulti = [...byPol.entries()].filter(([, a]) => a.length > 1);
const idPolDup = [...byIdPol.entries()].filter(([, a]) => a.length > 1);
const idMulti = [...byId.entries()].filter(([, a]) => a.length > 1);

const sinSinConPolizaId = all.filter(
  (c) => !hasVal(c.siniestro) && hasVal(c.identificacion) && hasVal(c.numeroPoliza)
);
const sinSinSinPoliza = all.filter((c) => !hasVal(c.siniestro) && !hasVal(c.numeroPoliza));

// inconsistencias leves
const polizaComoNumeroCeros = all.filter((c) => {
  const raw = String(c.numeroPoliza ?? '');
  return /^0+\d+$/.test(raw.replace(/\s+/g, ''));
}).length;
const idPlaceholder = all.filter((c) =>
  /^(n\/?a|na|por confirmar|pendiente|sin dato|-)$/i.test(String(c.identificacion || '').trim())
).length;
const sinConsecutivoAlfa = all.filter(
  (c) => !/^ALFA-\d{4}-\d{2}-\d+$/i.test(String(c.consecutivo || '').trim())
);

const imports = await AlfaExcelImport.find()
  .sort({ createdAt: -1 })
  .limit(8)
  .select('fileName fileHash status totals createdAt finishedAt alreadyImported source')
  .lean();

const oldest = all
  .filter((c) => c.createdAt)
  .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
const newest = all
  .filter((c) => c.createdAt)
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

const report = {
  collection: 'gsk3cAppsegurosAlfaCasos',
  readOnly: true,
  total,
  coverage: {
    conSiniestro,
    sinSiniestro: total - conSiniestro,
    conNumeroPoliza: conPoliza,
    sinNumeroPoliza: total - conPoliza,
    conIdentificacion: conId,
    sinIdentificacion: total - conId,
    conNumeroCredito: conCredito,
    sinNumeroCredito: total - conCredito,
    conConsecutivo,
    conArchivos,
    conLiquidador,
    conInforme,
  },
  estados: byEstado,
  camposPoblados: filled,
  candidatosUpdateSiniestro: {
    sinSiniestroPeroConIdYPoliza: sinSinConPolizaId.length,
    sinSiniestroNiPoliza: sinSinSinPoliza.length,
    nota: 'Estos casos pueden recibir siniestro del Excel vía match id+póliza → UPDATE (no CREATE)',
  },
  duplicados: {
    siniestrosRepetidos: siniestrosDup.length,
    casosAfectadosPorSiniestroDup: siniestrosDup.reduce((n, [, a]) => n + a.length, 0),
    polizasConVariosCasos: polizasMulti.length,
    casosEnPolizasMultiCaso: polizasMulti.reduce((n, [, a]) => n + a.length, 0),
    idMasPolizaAmbiguos: idPolDup.length,
    identificacionesConVariosCasos: idMulti.length,
  },
  inconsistencias: {
    polizasConCerosInicialesConservados: polizaComoNumeroCeros,
    identificacionesPlaceholder: idPlaceholder,
    consecutivosNoEstandar: sinConsecutivoAlfa.length,
    ejemplosConsecutivoNoEstandar: sinConsecutivoAlfa.slice(0, 5).map((c) => ({
      _id: String(c._id),
      consecutivo: c.consecutivo,
      identificacion: c.identificacion,
    })),
  },
  muestras: {
    sinSiniestroConIdPoliza: sinSinConPolizaId.slice(0, 10).map((c) => ({
      consecutivo: c.consecutivo,
      identificacion: c.identificacion,
      numeroPoliza: c.numeroPoliza,
      estado: c.estado,
    })),
    siniestrosDuplicados: siniestrosDup.slice(0, 8).map(([k, arr]) => ({
      siniestro: k,
      n: arr.length,
      consecutivos: arr.map((x) => x.consecutivo),
    })),
    polizasMultiCaso: polizasMulti.slice(0, 10).map(([k, arr]) => ({
      numeroPoliza: k,
      n: arr.length,
      consecutivos: arr.map((x) => x.consecutivo),
      siniestros: arr.map((x) => x.siniestro || null),
    })),
    idPolizaAmbiguos: idPolDup.slice(0, 8).map(([k, arr]) => ({
      key: k,
      n: arr.length,
      consecutivos: arr.map((x) => x.consecutivo),
      siniestros: arr.map((x) => x.siniestro || null),
    })),
  },
  rangoFechas: {
    primerCreatedAt: oldest?.createdAt || null,
    ultimoCreatedAt: newest?.createdAt || null,
  },
  importsExcelRecientes: imports,
  matchingConfirmado: {
    nivel1: 'siniestro normalizado → 1 MATCH / 0 nivel2 / 2+ AMBIGUOUS',
    nivel2: 'identificacion + numeroPoliza → 1 MATCH / 0 CREATE / 2+ AMBIGUOUS (o refuerzo)',
    nivel3: 'numeroCredito | fechaSiniestro | direccionPredio solo si inequívoco',
    prohibido: 'findOne({ numeroPoliza }) como llave única',
  },
  simulacionExcel: {
    disponible: false,
    motivo:
      'No hay archivo Excel Alfa en el workspace. Para estimar CREATE/UPDATE/UNCHANGED/AMBIGUOUS haga preview con el Excel real (POST /import/preview) — solo lectura de casos, no escribe hasta execute.',
  },
};

console.log(JSON.stringify(report, null, 2));
await mongoose.disconnect();
