/**
 * Carga Libro1.xlsx (hoja BASE BBVA) en gsk3cAppbbvaCatCasos.
 * Empareja por siniestro; no duplica.
 *
 * Uso:
 *   node scripts/importarBaseBbvaLibro1.js
 *   node scripts/importarBaseBbvaLibro1.js "C:\\ruta\\Libro1.xlsx"
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';
import { homologarEstadoBbvaCat } from '../utils/estadosBbvaCat.js';

const excelPath =
  process.argv[2] || 'C:\\Users\\GP-TI\\Downloads\\Libro1.xlsx';

const toTxt = (valor) => {
  if (valor === null || valor === undefined || valor === '') return '';
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    if (Math.abs(valor) >= 1e15) return String(valor);
    return String(Math.round(valor) === valor ? Math.round(valor) : valor);
  }
  return String(valor).replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
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

const obtenerMaxSecuencial = async () => {
  const patron = /^BBVA-CAT-(\d{4})-(\d{2})-(\d+)$/i;
  const registros = await BbvaCatCaso.find({
    consecutivo: { $exists: true, $nin: [null, ''] },
  })
    .select('consecutivo')
    .lean();
  let max = 0;
  for (const reg of registros) {
    const match = String(reg.consecutivo || '').trim().match(patron);
    if (match?.[3]) {
      const n = parseInt(match[3], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max;
};

const obtenerMaxSecuencialListado = async () => {
  const patron = /^BBVA-CAT-LST-(\d{4})-(\d{2})-(\d+)$/i;
  const registros = await BbvaCatListadoCaso.find({
    consecutivo: { $exists: true, $nin: [null, ''] },
  })
    .select('consecutivo')
    .lean();
  let max = 0;
  for (const reg of registros) {
    const match = String(reg.consecutivo || '').trim().match(patron);
    if (match?.[3]) {
      const n = parseInt(match[3], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max;
};

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('Falta MONGO_URI');
  }
  const wb = XLSX.readFile(excelPath, { cellDates: true });
  const hoja = wb.SheetNames.find((n) => /BASE BBVA/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, defval: null, raw: true });
  const data = rows.slice(2).filter((r) => r && r.some((c) => c != null && String(c).trim() !== ''));

  await mongoose.connect(process.env.MONGO_URI);
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  let secuencial = await obtenerMaxSecuencial();
  let secuencialListado = await obtenerMaxSecuencialListado();

  const resumen = {
    leidos: data.length,
    creados: 0,
    actualizados: 0,
    omitidos: 0,
    listadoCreados: 0,
    listadoActualizados: 0,
  };

  for (const row of data) {
    const siniestro = toTxt(row[0]);
    const identificacion = toTxt(row[1]);
    const asegurado = toTxt(row[2]);
    if (!siniestro && !identificacion) {
      resumen.omitidos += 1;
      continue;
    }
    const ramo = homologarRamo(row[12]);
    const celular = toTxt(row[6]);
    const correo = toTxt(row[7]);
    const direccionPredio = toTxt(row[3]);
    const payload = {
      siniestro,
      identificacion: identificacion || siniestro,
      tipoIdentificacion: identificacion ? 'CC' : '',
      asegurado,
      direccionPredio,
      departamento: toTxt(row[4]),
      ciudad: toTxt(row[5]),
      celular,
      correo,
      telefonoAsegurado: celular,
      correoAsegurado: correo,
      informacionContacto: [celular, correo].filter(Boolean).join(' | '),
      fechaSiniestro: fechaDia(row[8]),
      fechaCasoNuevo: fechaDia(row[9]) || fechaDia(row[8]) || ahora,
      tipoPoliza: ramo.tipoPoliza,
      tipoPolizaOtro: ramo.tipoPolizaOtro || undefined,
      causa: 'TERREMOTO',
      canalRadicacion: 'BBVA',
      tomador: 'BBVA SEGUROS',
      estado: homologarEstadoBbvaCat('CASO NUEVO'),
    };

    const existente = siniestro
      ? await BbvaCatCaso.findOne({ siniestro })
      : await BbvaCatCaso.findOne({ identificacion: payload.identificacion });

    if (existente) {
      const merge = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v === '' || v == null) continue;
        if (!existente[k]) merge[k] = v;
      }
      if (Object.keys(merge).length) {
        await BbvaCatCaso.updateOne({ _id: existente._id }, { $set: merge });
      }
      resumen.actualizados += 1;
    } else {
      secuencial += 1;
      await BbvaCatCaso.create({
        ...payload,
        consecutivo: `BBVA-CAT-${año}-${mes}-${secuencial}`,
      });
      resumen.creados += 1;
    }

    const payloadListado = {
      zc: siniestro,
      siniestro,
      identificacion: payload.identificacion,
      tipoIdentificacion: payload.tipoIdentificacion,
      asegurado,
      ciudad: payload.ciudad,
      departamento: payload.departamento,
      telefonoAsegurado: celular,
      correoAsegurado: correo,
      contactoAsegurado: [celular, correo].filter(Boolean).join(' | '),
      tipoPoliza: ramo.tipoPoliza,
      tipoPolizaOtro: ramo.tipoPolizaOtro || undefined,
      causa: 'TERREMOTO',
      estado: homologarEstadoBbvaCat('CASO NUEVO'),
      fechaCasoNuevo: payload.fechaCasoNuevo,
      observaciones: direccionPredio || '',
    };
    const existenteListado = siniestro
      ? await BbvaCatListadoCaso.findOne({ $or: [{ zc: siniestro }, { siniestro }] })
      : await BbvaCatListadoCaso.findOne({ identificacion: payload.identificacion });
    if (existenteListado) {
      const mergeL = {};
      for (const [k, v] of Object.entries(payloadListado)) {
        if (v === '' || v == null) continue;
        if (!existenteListado[k]) mergeL[k] = v;
      }
      if (Object.keys(mergeL).length) {
        await BbvaCatListadoCaso.updateOne({ _id: existenteListado._id }, { $set: mergeL });
      }
      resumen.listadoActualizados += 1;
    } else {
      secuencialListado += 1;
      await BbvaCatListadoCaso.create({
        ...payloadListado,
        consecutivo: `BBVA-CAT-LST-${año}-${mes}-${secuencialListado}`,
      });
      resumen.listadoCreados += 1;
    }
  }

  console.log(JSON.stringify({ hoja, archivo: excelPath, ...resumen }, null, 2));
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
