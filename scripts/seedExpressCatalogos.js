/**
 * Carga catálogos Express (amparos, analistas, intermediarios) en MongoDB.
 * Uso: node scripts/seedExpressCatalogos.js
 *      node scripts/seedExpressCatalogos.js --intermediarios-excel
 */

import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import { seedDefaults } from '../services/expressCatalogoService.js';
import { esIntermediarioValidoSeed } from '../utils/expressCatalogoUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCEL = path.resolve(__dirname, '../../SEGUIMIENTO SINIESTROS EXPRESS.xlsx');

async function connectMongo() {
  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI no definido');
  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
  } else if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
}

function intermediariosDesdeExcel() {
  const wb = XLSX.readFile(EXCEL);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['DATA PROSER EXPRESS'], { defval: '' });
  const conteo = new Map();
  for (const row of rows) {
    const v = String(row['INTERMEDIARIO'] ?? '').trim();
    if (!esIntermediarioValidoSeed(v)) continue;
    conteo.set(v, (conteo.get(v) ?? 0) + 1);
  }
  return [...conteo.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([nombre]) => nombre);
}

async function main() {
  const conExcel = process.argv.includes('--intermediarios-excel');
  await connectMongo();
  console.log('✅ MongoDB conectado');

  const intermediarios = conExcel ? intermediariosDesdeExcel() : [];
  const { creados, reactivados } = await seedDefaults({ intermediarios });

  console.log(`Catálogos Express: ${creados} nuevos, ${reactivados} reactivados`);
  if (conExcel) {
    console.log(`Intermediarios desde Excel (≥2 casos): ${intermediarios.length}`);
  } else {
    console.log('Tip: use --intermediarios-excel para cargar intermediarios usados en el Excel.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
