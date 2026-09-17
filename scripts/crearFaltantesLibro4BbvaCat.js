/**
 * Crea en BBVA CAT solo los siniestros de Libro4 que faltan.
 * No modifica estados ni datos de casos ya existentes.
 *
 *   node scripts/crearFaltantesLibro4BbvaCat.js
 *   node scripts/crearFaltantesLibro4BbvaCat.js --apply
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import fs from 'fs';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';
import { homologarEstadoBbvaCat } from '../utils/estadosBbvaCat.js';

const EXCEL = process.argv.find((a) => a.endsWith('.xlsx')) || 'C:\\Users\\GP-TI\\Downloads\\Libro4.xlsx';
const APPLY = process.argv.includes('--apply');

const toTxt = (valor) => {
  if (valor === null || valor === undefined || valor === '') return '';
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return String(Math.round(valor) === valor ? Math.round(valor) : valor);
  }
  return String(valor).replace(/\t/g, ' ').replace(/\r/g, ' ').replace(/\s+/g, ' ').trim();
};

const fechaDia = (valor) => {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const y = valor.getUTCFullYear();
    const m = String(valor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(valor.getUTCDate()).padStart(2, '0');
    return new Date(`${y}-${m}-${d}T12:00:00.000Z`);
  }
  if (typeof valor === 'number') {
    const utc = Date.UTC(1899, 11, 30) + Math.round(valor * 86400000);
    return fechaDia(new Date(utc));
  }
  const texto = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return new Date(`${texto.slice(0, 10)}T12:00:00.000Z`);
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : fechaDia(d);
};

const parseMoney = (valor) => {
  const t = toTxt(valor).replace(/[^0-9.,-]/g, '');
  if (!t || t === '-' || t === '.') return null;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const homologarRamo = (valor) => {
  const t = toTxt(valor)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
  if (t === 'HOMEOWNERS' || t === 'HOGAR') return { tipoPoliza: 'HOGAR', tipoPolizaOtro: '' };
  if (t === 'PROPERTY' || t === 'INCENDIO') return { tipoPoliza: 'INCENDIO', tipoPolizaOtro: '' };
  if (!t) return { tipoPoliza: '', tipoPolizaOtro: '' };
  return { tipoPoliza: 'OTRO', tipoPolizaOtro: toTxt(valor) };
};

const maxSecuencial = async (Model, patron) => {
  const registros = await Model.find({
    consecutivo: { $exists: true, $nin: [null, ''] },
  })
    .select('consecutivo')
    .lean();
  let max = 0;
  for (const reg of registros) {
    const match = String(reg.consecutivo || '')
      .trim()
      .match(patron);
    if (match?.[3]) {
      const n = parseInt(match[3], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max;
};

function leerFilas() {
  if (!fs.existsSync(EXCEL)) throw new Error(`No existe: ${EXCEL}`);
  const wb = XLSX.readFile(EXCEL, { cellDates: true });
  const hoja = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, defval: null, raw: true });
  const headerIdx = rows.findIndex((r) => /^NSINIESTRO$/i.test(toTxt(r?.[0])));
  if (headerIdx < 0) throw new Error('No se encontró fila NSINIESTRO');
  return rows.slice(headerIdx + 1).filter((r) => /^\d+$/.test(toTxt(r?.[0])));
}

function mapRow(row) {
  const nsiniestro = toTxt(row[0]);
  const stroBbva = toTxt(row[5]);
  const siniestroBbva = toTxt(row[29]);
  // En Libro4 el identificador real es NSINIESTRO (1000…). STRO BBVA a veces trae códigos cortos.
  const candidato =
    (stroBbva && /^\d{6,}$/.test(stroBbva) ? stroBbva : '') ||
    (siniestroBbva && /^\d{6,}$/.test(siniestroBbva) ? siniestroBbva : '') ||
    nsiniestro;
  const siniestro = candidato;
  const identificacion = toTxt(row[15]) || toTxt(row[31]) || siniestro;
  const asegurado = toTxt(row[25]);
  const ramo = homologarRamo(row[49] || row[9]);
  const celular = toTxt(row[26]);
  const correo = toTxt(row[27]);
  const direccionPredio = toTxt(row[13]);
  const ahora = new Date();
  return {
    nsiniestro,
    siniestro,
    payload: {
      siniestro,
      zc: nsiniestro,
      identificacion,
      tipoIdentificacion: identificacion ? 'CC' : '',
      asegurado,
      direccionPredio,
      departamento: toTxt(row[21]),
      ciudad: toTxt(row[22]),
      celular: celular === '0' ? '' : celular,
      correo,
      telefonoAsegurado: celular === '0' ? '' : celular,
      correoAsegurado: correo,
      informacionContacto: [celular === '0' ? '' : celular, correo].filter(Boolean).join(' | '),
      fechaSiniestro: fechaDia(row[18]),
      fechaAsignacion: ahora,
      fechaCasoNuevo: fechaDia(row[19]) || fechaDia(row[17]) || fechaDia(row[4]) || ahora,
      numeroPoliza: toTxt(row[30]) || toTxt(row[7]),
      tipoPoliza: ramo.tipoPoliza,
      tipoPolizaOtro: ramo.tipoPolizaOtro || undefined,
      causa: toTxt(row[12]) === '00002' ? 'TERREMOTO' : toTxt(row[12]) || 'TERREMOTO',
      canalRadicacion: 'BBVA',
      tomador: 'BBVA SEGUROS',
      estado: homologarEstadoBbvaCat('CASO NUEVO'),
      observacionesCat: toTxt(row[16]) || toTxt(row[46]),
      valorAseguradoInmueble: parseMoney(row[32]),
      valorAseguradoContenidos: parseMoney(row[33]),
      valorReclamado: parseMoney(row[38]),
      valorEstimadoAseguradora: parseMoney(row[20]),
      gradoAfectacion: toTxt(row[44]) || null,
      lucroCesante: toTxt(row[45]) || null,
    },
    direccionPredio,
    ramo,
    correo,
  };
}

async function main() {
  const data = leerFilas();
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);

  const existentes = await BbvaCatCaso.find({})
    .select('siniestro zc')
    .lean();
  const existentesListado = await BbvaCatListadoCaso.find({})
    .select('siniestro zc')
    .lean();
  const setCat = new Set();
  const setList = new Set();
  for (const d of existentes) {
    if (d.siniestro) setCat.add(String(d.siniestro).trim());
    if (d.zc) setCat.add(String(d.zc).trim());
  }
  for (const d of existentesListado) {
    if (d.siniestro) setList.add(String(d.siniestro).trim());
    if (d.zc) setList.add(String(d.zc).trim());
  }

  const faltantes = [];
  for (const row of data) {
    const mapped = mapRow(row);
    const faltaCat = !setCat.has(mapped.nsiniestro) && !setCat.has(mapped.siniestro);
    const faltaList = !setList.has(mapped.nsiniestro) && !setList.has(mapped.siniestro);
    if (faltaCat || faltaList) faltantes.push({ ...mapped, faltaCat, faltaList });
  }

  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  let secuencial = await maxSecuencial(BbvaCatCaso, /^BBVA-CAT-(\d{4})-(\d{2})-(\d+)$/i);
  let secuencialListado = await maxSecuencial(
    BbvaCatListadoCaso,
    /^BBVA-CAT-LST-(\d{4})-(\d{2})-(\d+)$/i
  );

  let creadosCat = 0;
  let creadosList = 0;
  const creados = [];

  if (APPLY) {
    for (const item of faltantes) {
      if (item.faltaCat) {
        secuencial += 1;
        await BbvaCatCaso.create({
          ...item.payload,
          consecutivo: `BBVA-CAT-${año}-${mes}-${secuencial}`,
        });
        setCat.add(item.nsiniestro);
        setCat.add(item.siniestro);
        creadosCat += 1;
      }
      if (item.faltaList) {
        secuencialListado += 1;
        await BbvaCatListadoCaso.create({
          zc: item.nsiniestro,
          siniestro: item.siniestro,
          identificacion: item.payload.identificacion,
          tipoIdentificacion: item.payload.tipoIdentificacion,
          asegurado: item.payload.asegurado,
          ciudad: item.payload.ciudad,
          departamento: item.payload.departamento,
          telefonoAsegurado: item.payload.telefonoAsegurado,
          correoAsegurado: item.correo,
          contactoAsegurado: item.payload.informacionContacto,
          tipoPoliza: item.ramo.tipoPoliza,
          tipoPolizaOtro: item.ramo.tipoPolizaOtro || undefined,
          causa: item.payload.causa,
          estado: homologarEstadoBbvaCat('CASO NUEVO'),
          fechaAsignacion: item.payload.fechaAsignacion,
          fechaCasoNuevo: item.payload.fechaCasoNuevo,
          observaciones: item.direccionPredio || '',
          valorAseguradoInmueble: item.payload.valorAseguradoInmueble || undefined,
          valorReclamado: item.payload.valorReclamado || undefined,
          valorEstimadoAseguradora: item.payload.valorEstimadoAseguradora || undefined,
          consecutivo: `BBVA-CAT-LST-${año}-${mes}-${secuencialListado}`,
        });
        setList.add(item.nsiniestro);
        setList.add(item.siniestro);
        creadosList += 1;
      }
      creados.push({
        siniestro: item.siniestro,
        zc: item.nsiniestro,
        asegurado: item.payload.asegurado,
        cat: item.faltaCat,
        listado: item.faltaList,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        modo: APPLY ? 'APPLY' : 'DRY-RUN',
        archivo: EXCEL,
        filasExcel: data.length,
        faltantes: faltantes.length,
        creadosCat: APPLY ? creadosCat : 0,
        creadosListado: APPLY ? creadosList : 0,
        detalle: faltantes.map((f) => ({
          siniestro: f.siniestro,
          zc: f.nsiniestro,
          asegurado: f.payload.asegurado,
          faltaCat: f.faltaCat,
          faltaListado: f.faltaList,
        })),
        nota: APPLY
          ? 'Solo se crearon faltantes en CASO NUEVO. Estados existentes no se tocaron.'
          : 'Sin cambios. Pase --apply para crear.',
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
