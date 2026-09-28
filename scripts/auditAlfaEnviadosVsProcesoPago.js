/**
 * Carpetas en CASOS ENVIADOS que NO corresponden a estado PROCESO DE PAGO.
 * Solo reporte (no borra).
 *
 * node scripts/auditAlfaEnviadosVsProcesoPago.js
 */
import fs from 'fs';
import path from 'path';
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { normalizeIdentification } from '../utils/alfaIdentification.js';

const FOLDER =
  process.env.ALFA_ENVIADOS_LOCAL ||
  path.join(
    process.env.OneDriveCommercial || process.env.OneDrive || '',
    'Documental Proser - SEGUROS ALFA',
    'CASOS ENVIADOS A LA ASEGURADORA'
  );

function normEstado(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function isProcesoPago(estado) {
  const e = normEstado(estado);
  return e === 'PROCESO DE PAGO' || e.includes('PROCESO DE PAGO');
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
});

if (!fs.existsSync(FOLDER)) {
  console.error('No existe carpeta local:', FOLDER);
  process.exit(1);
}

const folderNames = fs
  .readdirSync(FOLDER, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const folderById = new Map();
for (const name of folderNames) {
  const id = normalizeIdentification(name) || String(name).replace(/\D/g, '');
  if (!id) continue;
  if (!folderById.has(id)) folderById.set(id, []);
  folderById.get(id).push(name);
}

const casos = await SegurosAlfaCaso.find({ excluidoBaseAlfa: { $ne: true } })
  .select(
    'consecutivo identificacion asegurado estado estadoGestion numeroCredito numeroPoliza fechaEnvioAseguradora updatedAt'
  )
  .lean();

const procesoPago = casos.filter((c) => isProcesoPago(c.estado));
const byId = new Map();
for (const c of casos) {
  const id = normalizeIdentification(c.identificacion) || '';
  if (!id) continue;
  if (!byId.has(id)) byId.set(id, []);
  byId.get(id).push(c);
}

const procesoPagoIds = new Set(
  procesoPago
    .map((c) => normalizeIdentification(c.identificacion) || '')
    .filter(Boolean)
);

const sobran = [];
const okEnProceso = [];
const sinCasoMongo = [];

for (const [id, names] of folderById.entries()) {
  if (procesoPagoIds.has(id)) {
    okEnProceso.push({ id, carpetas: names });
    continue;
  }
  const casosId = byId.get(id) || [];
  if (!casosId.length) {
    sinCasoMongo.push({ id, carpetas: names });
    sobran.push({
      id,
      carpetas: names,
      motivo: 'SIN_CASO_EN_ARNALD',
      casos: [],
    });
    continue;
  }
  sobran.push({
    id,
    carpetas: names,
    motivo: 'ESTADO_NO_PROCESO_DE_PAGO',
    casos: casosId.map((c) => ({
      consecutivo: c.consecutivo,
      asegurado: c.asegurado,
      estado: c.estado,
      estadoGestion: c.estadoGestion,
      credito: c.numeroCredito,
      fechaEnvioAseguradora: c.fechaEnvioAseguradora || null,
    })),
  });
}

// Cédulas en proceso de pago sin carpeta
const faltanCarpeta = procesoPago
  .filter((c) => {
    const id = normalizeIdentification(c.identificacion) || '';
    return id && !folderById.has(id);
  })
  .map((c) => ({
    consecutivo: c.consecutivo,
    id: c.identificacion,
    asegurado: c.asegurado,
  }));

// Agrupar sobrantes por estado actual
const porEstado = new Map();
for (const s of sobran) {
  const est =
    s.casos?.[0]?.estado ||
    (s.motivo === 'SIN_CASO_EN_ARNALD' ? '(sin caso Mongo)' : '(desconocido)');
  if (!porEstado.has(est)) porEstado.set(est, []);
  porEstado.get(est).push(s);
}

const resumen = {
  carpetaLocal: FOLDER,
  carpetasTotales: folderNames.length,
  cedulasUnicasEnCarpetas: folderById.size,
  procesoPagoMongo: procesoPago.length,
  carpetasOkProcesoPago: okEnProceso.length,
  carpetasQueSobran: sobran.length,
  sinCasoMongo: sinCasoMongo.length,
  procesoPagoSinCarpeta: faltanCarpeta.length,
  porEstado: Object.fromEntries(
    [...porEstado.entries()].map(([k, arr]) => [k, arr.length])
  ),
};

console.log('=== RESUMEN ===');
console.log(JSON.stringify(resumen, null, 2));
console.log('\n=== CARPETAS QUE NO DEBERÍAN ESTAR (no están PROCESO DE PAGO) ===');
for (const s of sobran.sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
  const caso = s.casos?.[0];
  console.log(
    [
      s.id,
      `carpeta=${s.carpetas.join('|')}`,
      caso ? `estado=${caso.estado}` : s.motivo,
      caso ? `gestion=${caso.estadoGestion || ''}` : '',
      caso ? `consecutivo=${caso.consecutivo}` : '',
      caso ? `asegurado=${caso.asegurado || ''}` : '',
    ]
      .filter(Boolean)
      .join(' | ')
  );
}

if (faltanCarpeta.length) {
  console.log('\n=== PROCESO DE PAGO SIN CARPETA EN ENVIADOS ===');
  for (const f of faltanCarpeta) {
    console.log(`${f.id} | ${f.consecutivo} | ${f.asegurado}`);
  }
}

const outDir = path.join(process.cwd(), 'scripts', '_out');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'alfa-enviados-sobran-vs-proceso-pago.json');
fs.writeFileSync(
  outPath,
  JSON.stringify({ resumen, sobran, faltanCarpeta }, null, 2),
  'utf8'
);
console.log('\nJSON:', outPath);

await mongoose.disconnect();
