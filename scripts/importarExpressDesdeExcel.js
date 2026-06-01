/**
 * Importa la hoja "DATA PROSER EXPRESS" y reemplaza la colección gsk3cAppsiniestroExpress.
 *
 * Uso (desde /backend):
 *   node scripts/importarExpressDesdeExcel.js --dry-run
 *   node scripts/importarExpressDesdeExcel.js --replace
 *   node scripts/importarExpressDesdeExcel.js --replace --file "../SEGUIMIENTO SINIESTROS EXPRESS.xlsx"
 */

import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import SiniestroExpress from '../models/SiniestroExpress.js';
import Responsable from '../models/Responsable.js';
import EstadoExpress from '../models/EstadoExpress.js';
import { normalizarAmparoExpress } from '../constants/expressAmparos.js';
import {
  buildCatalogMaps as buildExpressCatalogMaps,
  normalizarConMapas,
} from '../services/expressCatalogoService.js';
import { normalizarConMapas } from '../services/expressCatalogoService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.resolve(__dirname, '../../SEGUIMIENTO SINIESTROS EXPRESS.xlsx');
const PREFERRED_SHEET_NAME = 'DATA PROSER EXPRESS';

const ASEGURADORA_DEFAULT = 'SIN_ASIGNAR';
const CIUDAD_DEFAULT = 'SIN_ASIGNAR';

const norm = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

const excelDateToJS = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && !Number.isNaN(value)) {
    const utc = new Date(Date.UTC(1899, 11, 30));
    const ms = value * 86400000;
    const date = new Date(utc.getTime() + ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toStringOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim();
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isNaN(n) ? null : n;
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
  const file =
    fileIdx >= 0 && args[fileIdx + 1]
      ? path.resolve(process.cwd(), args[fileIdx + 1])
      : DEFAULT_FILE;
  return { dryRun, replace, file };
}

async function buildCatalogMaps() {
  const [responsables, estados] = await Promise.all([
    Responsable.find().lean(),
    EstadoExpress.find().lean(),
  ]);

  const responsablePorNombre = new Map();
  for (const r of responsables) {
    const nombre = norm(r.nmbrRespnsble);
    if (nombre) {
      responsablePorNombre.set(nombre, String(r.codiRespnsble ?? r._id ?? nombre));
    }
  }

  const estadoPorDesc = new Map();
  for (const e of estados) {
    const desc = norm(e.descEstdo ?? e.descEstado);
    const codigo = String(e.codiEstdo ?? e.codiEstado ?? '');
    if (desc && codigo) estadoPorDesc.set(desc, codigo);
  }

  return { responsablePorNombre, estadoPorDesc };
}

function mapRow(row, maps, stats, rowIndex) {
  const numeroSiniestroBase = toStringOrNull(row['No Siniestro']);
  const filaExcel = toStringOrNull(row['__EMPTY']) || String(rowIndex + 1);
  const numeroSiniestro = numeroSiniestroBase || `SIN-NUMERO-${filaExcel}`;
  if (!numeroSiniestro) {
    stats.omitidosSinNumero += 1;
    return null;
  }

  const ajustador = norm(row['AJUSTADOR']);
  let responsable = maps.responsablePorNombre.get(ajustador);
  if (!responsable && ajustador) {
    responsable = ajustador;
    stats.responsableSinCatalogo.add(ajustador);
  }

  const estadoTexto = norm(row['ESTADO DE SINIESTRO']);
  let estadoProceso = maps.estadoPorDesc.get(estadoTexto);
  if (!estadoProceso && estadoTexto) {
    estadoProceso = estadoTexto;
    stats.estadoSinCatalogo.add(estadoTexto);
  }
  if (!estadoProceso) {
    estadoProceso = 'SIN_ESTADO';
    stats.estadoSinCatalogo.add('(vacío)');
  }

  const intermediarioRaw = toStringOrNull(row['INTERMEDIARIO']);
  const analistaRaw = toStringOrNull(row['ANALISTA']);
  const amparoRaw = toStringOrNull(row['AMPARO']);

  const amparo =
    normalizarConMapas(maps.expressCatalog, 'amparo', amparoRaw) ||
    normalizarAmparoExpress(amparoRaw) ||
    'RC PLO';
  if (amparoRaw && amparo !== amparoRaw && !normalizarConMapas(maps.expressCatalog, 'amparo', amparoRaw)) {
    if (!normalizarAmparoExpress(amparoRaw)) stats.amparoSinCatalogo.add(amparoRaw);
  }

  const analista =
    normalizarConMapas(maps.expressCatalog, 'analista', analistaRaw) ?? analistaRaw;
  if (analistaRaw && !normalizarConMapas(maps.expressCatalog, 'analista', analistaRaw)) {
    stats.analistaSinCatalogo.add(analistaRaw);
  }

  const intermediario =
    normalizarConMapas(maps.expressCatalog, 'intermediario', intermediarioRaw) ?? intermediarioRaw;
  if (intermediarioRaw && !normalizarConMapas(maps.expressCatalog, 'intermediario', intermediarioRaw)) {
    stats.intermediarioSinCatalogo.add(intermediarioRaw);
  }

  return {
    responsable,
    codigoWorkflow: toStringOrNull(row['WF']),
    numeroSiniestro,
    fechaSiniestro: excelDateToJS(row['FECHA DE SINIESTRO']),
    avisoSiniestro: excelDateToJS(row['Aviso de Siniestro AJUSTADOR']),
    avisoSiniestroCompania: excelDateToJS(row['Aviso de siniestro Compania']),
    fechaSolicitudDocumentos: excelDateToJS(row['Fecha Solicitud Documentos']),
    fechaReciboDocumentos: excelDateToJS(row['FECHA RECIBO DOCUMENTOS']),
    fechaEnvioAutorizacion: excelDateToJS(
      row['fecha envio para analisis de  autorizacion analista'] ??
        row['fecha envio para analisis de  autorizacion analista']
    ),
    fechaRespuestaAnalista: excelDateToJS(row['Fecha respuesta analista']),
    fechaPresentacionCifras: excelDateToJS(row['Fecha Presentación Cifras']),
    correoNotificacion: toStringOrNull(row['CORRREO DE NOTIFICACION']),
    fechaFiniquitosFirmado: excelDateToJS(row['Fecha recibo Finiquitos Firmados']),
    fechaCargueFiniquito: excelDateToJS(row['Fecha montaje finiquitos firmados']),
    fechaCierre: excelDateToJS(row['FECHA DE CIERRE']),
    amparo,
    valorIndemnizacion: toNumberOrNull(row['VALOR INDEMNIZADO']),
    reserva: toNumberOrNull(row['RESERVA']),
    observacionesSeguimiento:
      toStringOrNull(row['columna']) ||
      toStringOrNull(row['Columna']) ||
      toStringOrNull(row['Columna 2']),
    anexos: [],
    aseguradora: ASEGURADORA_DEFAULT,
    intermediario,
    ciudadSiniestro: CIUDAD_DEFAULT,
    aseguradoBeneficiario: toStringOrNull(row['ASEGURADO']) || 'SIN NOMBRE',
    nit: toStringOrNull(row['NIT']),
    analista: toStringOrNull(row['ANALISTA']),
    estadoProceso,
    salvamentoAplica: 'no_aplica',
    valorSalvamento: null,
    anexosSalvamento: [],
  };
}

async function generarConsecutivos(documentos) {
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  let secuencial = 0;
  return documentos.map((doc) => {
    secuencial += 1;
    return {
      ...doc,
      consecutivo: `EXP-${año}-${mes}-${secuencial}`,
    };
  });
}

async function main() {
  const { dryRun, replace, file } = parseArgs();

  if (!dryRun && !replace) {
    console.log('Indique --dry-run (simular) o --replace (borrar e importar).');
    process.exit(1);
  }

  const MONGO_URI = process.env.MONGO_URI;
  if (!dryRun && !MONGO_URI) {
    console.error('❌ MONGO_URI no definido (requerido para --replace)');
    process.exit(1);
  }

  console.log('📂 Archivo:', file);
  console.log('📄 Hoja preferida:', PREFERRED_SHEET_NAME);

  const wb = XLSX.readFile(file);
  const selectedSheet = wb.SheetNames.includes(PREFERRED_SHEET_NAME)
    ? PREFERRED_SHEET_NAME
    : wb.SheetNames[0];
  if (!selectedSheet) {
    console.error('❌ El archivo no contiene hojas.');
    process.exit(1);
  }
  if (selectedSheet !== PREFERRED_SHEET_NAME) {
    console.warn(
      `⚠️  No se encontró "${PREFERRED_SHEET_NAME}", usando hoja "${selectedSheet}".`
    );
  }
  console.log('📄 Hoja usada:', selectedSheet);

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[selectedSheet], { defval: '' });
  console.log('📊 Filas en Excel:', rows.length);

  let maps = {
    responsablePorNombre: new Map(),
    estadoPorDesc: new Map(),
    expressCatalog: { amparo: new Map(), analista: new Map(), intermediario: new Map() },
  };
  if (MONGO_URI) {
    try {
      await connectMongo();
      console.log('✅ MongoDB conectado');
      maps = await buildCatalogMaps();
      maps.expressCatalog = await buildExpressCatalogMaps();
    } catch (err) {
      if (!dryRun) throw err;
      console.warn(
        '⚠️  No se pudo conectar a MongoDB; dry-run sin catálogos (ajustador/estado como texto Excel).'
      );
      console.warn('   ', err.message);
    }
  } else if (dryRun) {
    console.warn('⚠️  Sin MONGO_URI; dry-run sin catálogos.');
  }
  const stats = {
    omitidosSinNumero: 0,
    responsableSinCatalogo: new Set(),
    estadoSinCatalogo: new Set(),
    amparoSinCatalogo: new Set(),
    analistaSinCatalogo: new Set(),
    intermediarioSinCatalogo: new Set(),
  };

  const documentos = [];
  rows.forEach((row, rowIndex) => {
    const doc = mapRow(row, maps, stats, rowIndex);
    if (doc) documentos.push(doc);
  });

  const conConsecutivo = await generarConsecutivos(documentos);

  console.log('\n--- Resumen ---');
  console.log('Casos a importar:', conConsecutivo.length);
  console.log('Omitidos (sin No Siniestro):', stats.omitidosSinNumero);
  console.log(
    'Responsables sin catálogo (se guarda nombre):',
    stats.responsableSinCatalogo.size
  );
  if (stats.responsableSinCatalogo.size) {
    console.log('  ', [...stats.responsableSinCatalogo].join(', '));
  }
  console.log('Estados sin código en catálogo:', stats.estadoSinCatalogo.size);
  if (stats.estadoSinCatalogo.size) {
    console.log('  ', [...stats.estadoSinCatalogo].slice(0, 15).join(', '));
  }
  console.log('Amparos fuera de catálogo:', stats.amparoSinCatalogo.size);
  if (stats.amparoSinCatalogo.size) {
    console.log('  ', [...stats.amparoSinCatalogo].join(', '));
  }
  console.log('Analistas sin catálogo:', stats.analistaSinCatalogo.size);
  if (stats.analistaSinCatalogo.size) {
    console.log('  ', [...stats.analistaSinCatalogo].slice(0, 10).join(', '));
  }
  console.log('Intermediarios sin catálogo:', stats.intermediarioSinCatalogo.size);
  if (stats.intermediarioSinCatalogo.size) {
    console.log('  ', [...stats.intermediarioSinCatalogo].slice(0, 10).join(', '));
  }
  console.log(`\n⚠️  Aseguradora y ciudad no vienen en Excel → se usa "${ASEGURADORA_DEFAULT}" / "${CIUDAD_DEFAULT}"`);
  console.log('   Complételos en Carga Express después de importar si aplica.\n');

  if (dryRun) {
    console.log('🔍 Modo dry-run: no se escribió en base de datos.');
    if (conConsecutivo[0]) {
      console.log('Ejemplo primer caso:', JSON.stringify(conConsecutivo[0], null, 2));
    }
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
    return;
  }

  const existentes = await SiniestroExpress.countDocuments();
  const deleted = await SiniestroExpress.deleteMany({});
  console.log(`🗑️  Eliminados ${deleted.deletedCount} registros (antes había ${existentes}).`);

  const BATCH = 200;
  let insertados = 0;
  for (let i = 0; i < conConsecutivo.length; i += BATCH) {
    const lote = conConsecutivo.slice(i, i + BATCH);
    await SiniestroExpress.insertMany(lote, { ordered: false });
    insertados += lote.length;
    console.log(`   Insertados ${insertados}/${conConsecutivo.length}...`);
  }

  const total = await SiniestroExpress.countDocuments();
  console.log(`\n✅ Importación completa. Total en colección: ${total}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
