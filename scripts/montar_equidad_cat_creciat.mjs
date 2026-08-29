/**
 * Carga el Excel CRECIAT en gsk3cAppequidadCatCasos.
 * Uso: node scripts/montar_equidad_cat_creciat.mjs
 */
import dns from 'dns';
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const XLSX_PATH = process.argv[2] || 'C:/Users/GP-TI/Downloads/FONDO DE EMPLEADOS DEL CIAT CRECIAT.xlsx';

const CAMPOS_FECHA = [
  'fechaAviso',
  'fechaAsignacion',
  'fechaVisita',
  'fechaDefinicion',
  'fechaUltimoDocumento',
  'fechaCausacion',
  'fechaGiro',
  'fechaCasoNuevo',
];

const toDate = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor;
  }
  const texto = String(valor).trim();
  if (!texto || /invalid date/i.test(texto) || /^(n\/?c|pendiente|-)$/i.test(texto)) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) {
    const d = new Date(`${texto.slice(0, 10)}T12:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d;
};

const normClave = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

const parserUrl = pathToFileURL(
  path.join(
    __dirname,
    '../../grupoproser-frontend/src/components/SubcomponenteEquidadCat/importarEquidadCatExcel.js'
  )
).href;
const { parsearListadoClienteEquidadCatDesdeExcel } = await import(parserUrl);
const EquidadCatCaso = (await import('../models/EquidadCatCaso.js')).default;

const buf = fs.readFileSync(XLSX_PATH);
const file = new File([buf], path.basename(XLSX_PATH));
const parsed = await parsearListadoClienteEquidadCatDesdeExcel(file);

console.log('muestra', {
  n: parsed.casos.length,
  keys: Object.keys(parsed.casos[0] || {}),
  siniestro: parsed.casos[0]?.siniestro,
  asegurado: parsed.casos[0]?.asegurado,
});

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 20000,
});

const existentes = await EquidadCatCaso.find({}, { siniestro: 1, consecutivo: 1 }).lean();
const indice = new Set(existentes.map((d) => normClave(d.siniestro)).filter(Boolean));

const patron = /^EQUIDAD-CAT-(\d{4})-(\d{2})-(\d+)$/i;
let max = 0;
for (const reg of existentes) {
  const match = String(reg.consecutivo || '').trim().match(patron);
  if (match?.[3]) {
    const n = parseInt(match[3], 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
}

const ahora = new Date();
const año = ahora.getFullYear();
const mes = String(ahora.getMonth() + 1).padStart(2, '0');

let creados = 0;
let omitidos = 0;
let sinSiniestro = 0;
let duplicados = 0;
const errores = [];

const existentesCount = existentes.length;
console.log('existentes en BD', existentesCount);

for (const fila of parsed.casos) {
  const siniestro = String(fila.siniestro || '').trim();
      if (!siniestro) {
        omitidos += 1;
        sinSiniestro += 1;
        continue;
      }
  const clave = normClave(siniestro);
  if (indice.has(clave)) {
    omitidos += 1;
    duplicados += 1;
    continue;
  }
  max += 1;
  const doc = {
    ...fila,
    siniestro,
    identificacion: String(fila.identificacion || siniestro),
    numeroCasoCliente: fila.numeroCasoCliente != null ? String(fila.numeroCasoCliente) : '',
    consecutivo: `EQUIDAD-CAT-${año}-${mes}-${max}`,
    estado: fila.estado || 'CASO NUEVO',
    fechaCasoNuevo: ahora,
    ajustador: '',
    inspector: '',
  };
  delete doc.ajustador;
  delete doc.inspector;
  for (const campo of CAMPOS_FECHA) {
    const d = toDate(doc[campo]);
    if (d) doc[campo] = d;
    else delete doc[campo];
  }
  if (!doc.fechaCasoNuevo) doc.fechaCasoNuevo = ahora;
  try {
    await EquidadCatCaso.create(doc);
    indice.add(clave);
    creados += 1;
  } catch (err) {
    omitidos += 1;
    errores.push({ siniestro, motivo: err.message });
  }
}

console.log(
  JSON.stringify(
    {
      hoja: parsed.hoja,
      recibidos: parsed.casos.length,
      creados,
      omitidos,
      sinSiniestro,
      duplicados,
      existentes: existentesCount,
      errores: errores.slice(0, 8),
    },
    null,
    2
  )
);

await mongoose.disconnect();
if (errores.length === parsed.casos.length) process.exit(1);
