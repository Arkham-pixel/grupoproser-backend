/**
 * Importa intermediarios desde Excel a la colección `intermediarios`.
 * Uso:
 *   node scripts/importarIntermediariosDesdeExcel.js
 *   node scripts/importarIntermediariosDesdeExcel.js --dry-run
 *   node scripts/importarIntermediariosDesdeExcel.js --archivo "C:/ruta/INTERMEDIARIO_LIMPIO.xlsx"
 */

import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import Intermediario from '../models/Intermediario.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXCEL = 'C:/Users/GP-TI/OneDrive/Documentos/INTERMEDIARIO_LIMPIO.xlsx';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const archivoArg = args.find((a) => a.startsWith('--archivo='));
const EXCEL = archivoArg ? archivoArg.split('=').slice(1).join('=') : DEFAULT_EXCEL;

function normalizeNombre(nombre) {
  return String(nombre || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

async function connectMongo() {
  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI no definido en .env');
  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
  } else if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
}

function leerNombresDesdeExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const nombres = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = String(rows[i][0] || '').trim();
    if (!raw) continue;
    if (i === 0 && raw.toUpperCase() === 'INTERMEDIARIO') continue;
    nombres.push(raw);
  }

  return nombres;
}

function siguienteCodigoNumerico(existentes) {
  let max = 100000;
  for (const item of existentes) {
    const n = parseInt(String(item.codigo || '').replace(/\D/g, ''), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

async function main() {
  console.log(`Archivo: ${EXCEL}`);
  console.log(dryRun ? 'Modo: DRY-RUN (sin escribir en BD)' : 'Modo: IMPORTACIÓN');

  const nombresExcel = leerNombresDesdeExcel(EXCEL);
  console.log(`Nombres en Excel: ${nombresExcel.length}`);

  await connectMongo();
  console.log('MongoDB conectado');

  const existentes = await Intermediario.find({}).lean();
  const porNombre = new Map();
  const codigosUsados = new Set();

  for (const item of existentes) {
    porNombre.set(normalizeNombre(item.nombre), item);
    if (item.codigo) codigosUsados.add(String(item.codigo));
  }

  let nextCodigo = siguienteCodigoNumerico(existentes);
  const aCrear = [];
  const omitidos = [];
  const vistosExcel = new Set();

  for (const nombre of nombresExcel) {
    const key = normalizeNombre(nombre);
    if (porNombre.has(key)) {
      omitidos.push({ nombre, motivo: 'ya existe en BD', existente: porNombre.get(key).nombre });
      continue;
    }
    if (vistosExcel.has(key)) {
      omitidos.push({ nombre, motivo: 'duplicado en Excel' });
      continue;
    }
    vistosExcel.add(key);

    let codigo = String(nextCodigo++);
    while (codigosUsados.has(codigo)) {
      codigo = String(nextCodigo++);
    }
    codigosUsados.add(codigo);

    aCrear.push({
      codigo,
      nombre: nombre.trim(),
      correo: '',
      telefono: '',
      direccion: '',
      ciudad: '',
      estado: 1,
    });
  }

  console.log(`Existentes en BD: ${existentes.length}`);
  console.log(`A crear: ${aCrear.length}`);
  console.log(`Omitidos: ${omitidos.length}`);

  if (omitidos.length > 0) {
    console.log('\n--- Omitidos (primeros 15) ---');
    omitidos.slice(0, 15).forEach((o) => {
      console.log(`  - ${o.nombre} (${o.motivo}${o.existente ? `: ${o.existente}` : ''})`);
    });
    if (omitidos.length > 15) console.log(`  ... y ${omitidos.length - 15} más`);
  }

  if (aCrear.length === 0) {
    console.log('\nNo hay registros nuevos para importar.');
    await mongoose.disconnect();
    return;
  }

  console.log('\n--- Primeros 10 a crear ---');
  aCrear.slice(0, 10).forEach((item) => {
    console.log(`  ${item.codigo} | ${item.nombre}`);
  });

  if (dryRun) {
    console.log('\nDRY-RUN finalizado. Ejecute sin --dry-run para importar.');
    await mongoose.disconnect();
    return;
  }

  const resultado = await Intermediario.insertMany(aCrear, { ordered: false });
  console.log(`\nImportación completada: ${resultado.length} intermediarios creados.`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Error:', err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
