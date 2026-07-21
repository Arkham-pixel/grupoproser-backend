/**
 * Importa el Excel de Fundación de la Mujer (OLA INVERNAL) a la colección gsk3cAppequidadFdmCasos.
 *
 * Uso (desde /grupoproser-backend):
 *   node scripts/importarEquidadFdmDesdeExcel.js --dry-run --file "ruta/al/archivo.xlsx"
 *   node scripts/importarEquidadFdmDesdeExcel.js --replace --file "ruta/al/archivo.xlsx"
 */

import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import path from 'path';
import XLSX from 'xlsx';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';

const limpiarTexto = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const texto = String(value).replace(/\s+/g, ' ').trim();
  return texto || null;
};

const limpiarTextoMayusculas = (value) => {
  const texto = limpiarTexto(value);
  return texto ? texto.toUpperCase() : null;
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isNaN(n) ? null : n;
};

/** Convierte serial de Excel o textos tipo "13/02/2026", "1302/2026", "03/02/20/26" */
const parseFechaFlexible = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === 'number' && !Number.isNaN(value)) {
    const utc = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(utc.getTime() + value * 86400000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const texto = String(value).trim();

  let match = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, d, m, y] = match.map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }

  // "1302/2026" → 13/02/2026 (dígitos de día y mes pegados)
  match = texto.match(/^(\d{2})(\d{2})\/(\d{4})$/);
  if (match) {
    const d = Number(match[1]);
    const m = Number(match[2]);
    const y = Number(match[3]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) return new Date(y, m - 1, d, 12, 0, 0);
  }

  // "03/02/20/26" → 03/02/2026 (año partido)
  match = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\/(\d{2})$/);
  if (match) {
    const d = Number(match[1]);
    const m = Number(match[2]);
    const y = Number(`${match[3]}${match[4]}`);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) return new Date(y, m - 1, d, 12, 0, 0);
  }

  const parsed = new Date(texto);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const mongoOptions = {
  serverSelectionTimeoutMS: 30000,
  retryWrites: true,
  w: 'majority',
};

async function connectMongo() {
  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI no definido');
  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
  } else if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }
  await mongoose.connect(uri, mongoOptions);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const replace = args.includes('--replace');
  const fileIdx = args.indexOf('--file');
  const file = fileIdx >= 0 && args[fileIdx + 1] ? path.resolve(process.cwd(), args[fileIdx + 1]) : null;
  return { dryRun, replace, file };
}

/** Índices de columnas según la fila de encabezados del Excel OLA INVERNAL */
const COL = {
  numero: 0,
  nombre: 1,
  cedula: 2,
  celular: 3,
  direccionAfectada: 4,
  municipio: 5,
  ajustador: 6,
  aif: 7,
  polizaDanosVigente: 8,
  polizaAfectar: 9,
  orden: 10,
  vigenciaPoliza: 11,
  afectacionesAnteriores: 12,
  siniestroIndemnizado: 13,
  valorEdificio: 14,
  valorContenido: 15,
  valoresIndemnizables: 16,
  subsidioEmpresarial: 17,
  cobertura: 18,
  primas: 19,
  tipoNegocio: 20,
  perdidaContenidos: 21,
  perdidaEdificio: 22,
  totalPerdida: 23,
  deducible: 24,
  totalLiquidado: 25,
  subsidio: 26,
  valorIndemnizadoAjustador: 27,
  caso: 28,
  siniestro: 29,
  fechaLiquidacion: 30,
  fechaAviso: 31,
  valorObjecion: 32,
  fechaCausacion: 33,
  valorIndemnizado: 34,
  fechaGiro: 35,
  estado: 36,
  observaciones: 37,
  detalle: 38,
};

function mapRow(row) {
  const nombre = limpiarTexto(row[COL.nombre]);
  const cedula = limpiarTexto(row[COL.cedula]);
  if (!nombre && !cedula) return null;

  const cobertura = limpiarTextoMayusculas(row[COL.cobertura]);

  return {
    numero: toNumberOrNull(row[COL.numero]),
    nombre: nombre || 'SIN NOMBRE',
    cedula,
    celular: limpiarTexto(row[COL.celular]),
    direccionAfectada: limpiarTexto(row[COL.direccionAfectada]),
    municipio: limpiarTextoMayusculas(row[COL.municipio]),
    ajustador: limpiarTextoMayusculas(row[COL.ajustador]),
    aif: limpiarTextoMayusculas(row[COL.aif]),
    polizaDanosVigente: limpiarTextoMayusculas(row[COL.polizaDanosVigente]),
    polizaAfectar: limpiarTexto(row[COL.polizaAfectar]),
    orden: limpiarTexto(row[COL.orden]),
    vigenciaPoliza: limpiarTexto(row[COL.vigenciaPoliza]),
    afectacionesAnteriores: limpiarTextoMayusculas(row[COL.afectacionesAnteriores]),
    siniestroIndemnizado: limpiarTextoMayusculas(row[COL.siniestroIndemnizado]),
    valorEdificio: toNumberOrNull(row[COL.valorEdificio]),
    valorContenido: toNumberOrNull(row[COL.valorContenido]),
    valoresIndemnizables: toNumberOrNull(row[COL.valoresIndemnizables]),
    subsidioEmpresarial: limpiarTextoMayusculas(row[COL.subsidioEmpresarial]),
    cobertura: cobertura === 'ANEGACIÓN' ? 'ANEGACION' : cobertura,
    primas: limpiarTextoMayusculas(row[COL.primas]),
    tipoNegocio: limpiarTextoMayusculas(row[COL.tipoNegocio]),
    perdidaContenidos: toNumberOrNull(row[COL.perdidaContenidos]),
    perdidaEdificio: toNumberOrNull(row[COL.perdidaEdificio]),
    totalPerdida: toNumberOrNull(row[COL.totalPerdida]),
    deducible: toNumberOrNull(row[COL.deducible]),
    totalLiquidado: toNumberOrNull(row[COL.totalLiquidado]),
    subsidio: toNumberOrNull(row[COL.subsidio]),
    valorIndemnizadoAjustador: toNumberOrNull(row[COL.valorIndemnizadoAjustador]),
    caso: limpiarTexto(row[COL.caso]),
    siniestro: limpiarTexto(row[COL.siniestro]),
    fechaLiquidacion: parseFechaFlexible(row[COL.fechaLiquidacion]),
    fechaAviso: parseFechaFlexible(row[COL.fechaAviso]),
    valorObjecion: limpiarTexto(row[COL.valorObjecion]),
    fechaCausacion: parseFechaFlexible(row[COL.fechaCausacion]),
    valorIndemnizado: toNumberOrNull(row[COL.valorIndemnizado]),
    fechaGiro: parseFechaFlexible(row[COL.fechaGiro]),
    estado: limpiarTextoMayusculas(row[COL.estado]) || 'PENDIENTE',
    observaciones: limpiarTexto(row[COL.observaciones]),
    detalle: limpiarTextoMayusculas(row[COL.detalle]),
  };
}

function generarConsecutivos(documentos) {
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  return documentos.map((doc, i) => ({ ...doc, consecutivo: `FDM-${año}-${mes}-${i + 1}` }));
}

async function main() {
  const { dryRun, replace, file } = parseArgs();

  if (!dryRun && !replace) {
    console.log('Indique --dry-run (simular) o --replace (borrar e importar).');
    process.exit(1);
  }
  if (!file) {
    console.error('❌ Indique el archivo con --file "ruta/al/archivo.xlsx"');
    process.exit(1);
  }

  console.log('📂 Archivo:', file);
  const wb = XLSX.readFile(file);
  const sheetName = wb.SheetNames[0];
  console.log('📄 Hoja usada:', sheetName);

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });

  // Localiza la fila de encabezados (la que contiene "NOMBRE" y "CEDULA")
  const headerIdx = rows.findIndex(
    (r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim().toUpperCase() === 'NOMBRE')
  );
  if (headerIdx < 0) {
    console.error('❌ No se encontró la fila de encabezados (columna NOMBRE).');
    process.exit(1);
  }

  const dataRows = rows.slice(headerIdx + 1);
  const documentos = [];
  for (const row of dataRows) {
    if (!Array.isArray(row)) continue;
    const doc = mapRow(row);
    if (doc) documentos.push(doc);
  }

  const conConsecutivo = generarConsecutivos(documentos);

  console.log('\n--- Resumen ---');
  console.log('Casos a importar:', conConsecutivo.length);
  const porEstado = conConsecutivo.reduce((acc, d) => {
    acc[d.estado] = (acc[d.estado] || 0) + 1;
    return acc;
  }, {});
  console.log('Por estado:', JSON.stringify(porEstado));

  if (dryRun) {
    console.log('\n🔍 Modo dry-run: no se escribió en base de datos.');
    if (conConsecutivo[0]) {
      console.log('Ejemplo primer caso:', JSON.stringify(conConsecutivo[0], null, 2));
    }
    return;
  }

  await connectMongo();
  console.log('✅ MongoDB conectado');

  const existentes = await EquidadFdmCaso.countDocuments();
  const deleted = await EquidadFdmCaso.deleteMany({});
  console.log(`🗑️  Eliminados ${deleted.deletedCount} registros (antes había ${existentes}).`);

  await EquidadFdmCaso.insertMany(conConsecutivo, { ordered: false });
  const total = await EquidadFdmCaso.countDocuments();
  console.log(`\n✅ Importación completa. Total en colección: ${total}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
