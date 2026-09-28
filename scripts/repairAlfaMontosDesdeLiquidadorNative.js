/**
 * Fuerza corrección caso 1144158482 + repara todos con native driver (sin hooks).
 * node scripts/repairAlfaMontosDesdeLiquidadorNative.js [--dry-run]
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  aplicarMontosOficialesDesdeLiquidadorAlfa,
  liquidadorAlfaTieneCifras,
} from '../utils/valoresLiquidadorAlfa.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const DRY = process.argv.includes('--dry-run');
const ONLY = process.argv.find((a) => a.startsWith('--id='))?.slice(5) || null;

const CAMPOS = [
  'valorReclamado',
  'valorLiquidado',
  'liquidadoCoberturaTerremo',
  'deducibleTerremoto',
  'valorLiquidacionCoberturasAdicionales',
  'deducibleCoberturasAdicionales',
  'valorTotalPagar',
  'reserva',
];

function sameMonto(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
console.log('uri host', String(uri || '').replace(/:[^:@/]+@/, ':***@').slice(0, 80));

await mongoose.connect(uri, { serverSelectionTimeoutMS: 25000 });
const col = mongoose.connection.db.collection('gsk3cAppsegurosAlfaCasos');

const filter = {
  excluidoBaseAlfa: { $ne: true },
  liquidador: { $exists: true, $ne: null, $type: 'object' },
};
if (ONLY) filter.identificacion = ONLY;

const casos = await col
  .find(filter)
  .project(Object.fromEntries(['_id', 'consecutivo', 'identificacion', 'liquidador', ...CAMPOS].map((k) => [k, 1])))
  .toArray();

let patched = 0;
const samples = [];
for (const caso of casos) {
  if (!liquidadorAlfaTieneCifras(caso.liquidador)) continue;
  const sanado = aplicarMontosOficialesDesdeLiquidadorAlfa(caso);
  if (sanado.valorLiquidado != null) sanado.reserva = sanado.valorLiquidado;
  const patch = {};
  for (const f of CAMPOS) {
    if (sameMonto(caso[f], sanado[f])) continue;
    if (sanado[f] == null) continue;
    patch[f] = sanado[f];
  }
  if (!Object.keys(patch).length) continue;
  patched += 1;
  if (String(caso.identificacion) === '1144158482' || samples.length < 5) {
    samples.push({
      consecutivo: caso.consecutivo,
      identificacion: caso.identificacion,
      before: Object.fromEntries(CAMPOS.map((f) => [f, caso[f]])),
      after: Object.fromEntries(CAMPOS.map((f) => [f, patch[f] ?? caso[f]])),
      campos: Object.keys(patch),
    });
  }
  if (DRY) continue;
  const r = await col.updateOne(
    { _id: caso._id },
    { $set: { ...patch, updatedAt: new Date() } }
  );
  if (String(caso.identificacion) === '1144158482') {
    console.log('update114', r);
  }
}

console.log(JSON.stringify({ dry: DRY, casos: casos.length, patched, samples }, null, 2));

if (!DRY && ONLY === '1144158482') {
  const c = await col.findOne(
    { identificacion: '1144158482' },
    { projection: Object.fromEntries(CAMPOS.map((f) => [f, 1])) }
  );
  console.log('verify', c);
}

await mongoose.disconnect();
