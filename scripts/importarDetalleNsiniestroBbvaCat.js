/**
 * Carga Libro1 Detalle NSINIESTRO (Zurich/BBVA) sin pisar casos ni bloques fijos.
 * Solo crea siniestros que no existan en CAT ni listado.
 *
 * Uso:
 *   node scripts/importarDetalleNsiniestroBbvaCat.js "C:\\ruta\\Libro1.xlsx"
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';
import { homologarEstadoBbvaCat } from '../utils/estadosBbvaCat.js';
import {
  casoNecesitaGeocode,
  construirQueryGeocodeBbvaCat,
  construirQueryLugarNombradoBbvaCat,
  esDireccionPredioGeocodableBbvaCat,
  geocodeDireccionGoogle,
  hashDireccionBbvaCat,
  fijarBloquesCercaniaBbvaCat,
  persistirAsignacionBloquesNuevosBbvaCat,
} from '../services/bbvaCatBloquesCercaniaService.js';

const excelPath = process.argv[2] || 'C:\\Users\\GP-TI\\Downloads\\Libro1.xlsx';

const toTxt = (valor) => {
  if (valor === null || valor === undefined || valor === '') return '';
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    if (Math.abs(valor) >= 1e15) return String(valor);
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

const parseMoney = (valor) => {
  const t = toTxt(valor).replace(/[^0-9.,-]/g, '');
  if (!t || t === '-' || t === '.') return null;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const maxSecuencial = async (Model, patron) => {
  const registros = await Model.find({
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

const leerFilas = () => {
  const wb = XLSX.readFile(excelPath, { cellDates: true });
  const hoja =
    wb.SheetNames.find((n) => /detalle/i.test(n)) ||
    wb.SheetNames.find((n) => /BASE BBVA/i.test(n)) ||
    wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, defval: null, raw: true });
  const headerIdx = rows.findIndex((r) =>
    /^NSINIESTRO$/i.test(toTxt(r?.[0]))
  );
  if (headerIdx < 0) throw new Error('No se encontró la fila NSINIESTRO');
  const data = rows.slice(headerIdx + 1).filter((r) => /^\d+$/.test(toTxt(r?.[0])));
  return { hoja, data };
};

async function geocodeNuevos(wfs) {
  const casos = await BbvaCatCaso.find({
    $or: [{ siniestro: { $in: wfs } }, { zc: { $in: wfs } }],
  });
  const resumen = { evaluados: casos.length, ok: 0, failed: 0, sinDireccion: 0, yaOk: 0 };
  for (const caso of casos) {
    if (!casoNecesitaGeocode(caso.toObject?.() || caso, { force: false })) {
      resumen.yaOk += 1;
      continue;
    }
    const query = construirQueryGeocodeBbvaCat(caso);
    const hash = hashDireccionBbvaCat(caso.direccionPredio, caso.ciudad, caso.departamento);
    if (!esDireccionPredioGeocodableBbvaCat(caso.direccionPredio)) {
      caso.set('ubicacionPredio.geocodeStatus', 'sin_direccion');
      caso.set('ubicacionPredio.geocodeQuery', query);
      caso.set('ubicacionPredio.direccionHash', hash);
      caso.set('ubicacionPredio.geocodedAt', new Date());
      await caso.save();
      resumen.sinDireccion += 1;
      continue;
    }
    let geo = await geocodeDireccionGoogle(query);
    if (geo.status !== 'ok' && geo.error === 'PRECISION_TOO_LOW') {
      const qLugar = construirQueryLugarNombradoBbvaCat(caso);
      if (qLugar && qLugar !== query) {
        const geo2 = await geocodeDireccionGoogle(qLugar);
        if (geo2.status === 'ok') geo = { ...geo2, geocodeQuery: qLugar };
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    if (geo.status === 'ok') {
      caso.ubicacionPredio = {
        lat: geo.lat,
        lng: geo.lng,
        geocodeStatus: 'ok',
        geocodeQuery: geo.geocodeQuery || query,
        direccionHash: hash,
        geocodedAt: new Date(),
        locationType: geo.locationType || '',
        formattedAddress: geo.formattedAddress || '',
      };
      await caso.save();
      resumen.ok += 1;
    } else {
      caso.set(
        'ubicacionPredio.geocodeStatus',
        geo.status === 'sin_direccion' ? 'sin_direccion' : 'failed'
      );
      caso.set('ubicacionPredio.geocodeQuery', query);
      caso.set('ubicacionPredio.direccionHash', hash);
      caso.set('ubicacionPredio.geocodedAt', new Date());
      if (geo.status === 'sin_direccion') resumen.sinDireccion += 1;
      else resumen.failed += 1;
      await caso.save();
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return resumen;
}

async function main() {
  if (!process.env.MONGO_URI && !process.env.MONGO_URI_DIRECT) {
    throw new Error('Falta MONGO_URI');
  }
  const { hoja, data } = leerFilas();
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);

  const freeze = await fijarBloquesCercaniaBbvaCat({ radioKm: 5, forzar: false });

  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  let secuencial = await maxSecuencial(BbvaCatCaso, /^BBVA-CAT-(\d{4})-(\d{2})-(\d+)$/i);
  let secuencialListado = await maxSecuencial(
    BbvaCatListadoCaso,
    /^BBVA-CAT-LST-(\d{4})-(\d{2})-(\d+)$/i
  );

  const resumen = {
    hoja,
    leidos: data.length,
    creados: 0,
    yaExistian: 0,
    omitidos: 0,
    listadoCreados: 0,
    listadoYaExistian: 0,
  };
  const wfsNuevos = [];

  for (const row of data) {
    const nsiniestro = toTxt(row[0]);
    const stroBbva = toTxt(row[5]);
    const siniestroBbva = toTxt(row[29]);
    const siniestro = stroBbva || siniestroBbva || nsiniestro;
    const identificacion = toTxt(row[15]) || toTxt(row[31]) || siniestro;
    const asegurado = toTxt(row[25]);
    if (!/^\d+$/.test(nsiniestro)) {
      resumen.omitidos += 1;
      continue;
    }
    const ramo = homologarRamo(row[49] || row[9]);
    const celular = toTxt(row[26]);
    const correo = toTxt(row[27]);
    const direccionPredio = toTxt(row[13]);
    const payload = {
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
      fechaCasoNuevo: fechaDia(row[19]) || fechaDia(row[17]) || fechaDia(row[4]) || ahora,
      numeroPoliza: toTxt(row[30]) || toTxt(row[7]),
      tipoPoliza: ramo.tipoPoliza,
      tipoPolizaOtro: ramo.tipoPolizaOtro || undefined,
      causa: toTxt(row[12]) === '00002' ? 'TERREMOTO' : toTxt(row[12]) || 'TERREMOTO',
      canalRadicacion: 'BBVA',
      tomador: 'BBVA SEGUROS',
      estado: homologarEstadoBbvaCat('CASO NUEVO'),
      observacionesCat: toTxt(row[16]) || toTxt(row[45]),
      valorAseguradoInmueble: parseMoney(row[32]),
      valorAseguradoContenidos: parseMoney(row[33]),
      valorReclamado: parseMoney(row[38]),
      valorEstimadoAseguradora: parseMoney(row[20]),
      gradoAfectacion: toTxt(row[43]) || null,
      lucroCesante: toTxt(row[44]) || null,
    };

    const existente = await BbvaCatCaso.findOne({
      $or: [{ siniestro }, { zc: nsiniestro }, { siniestro: nsiniestro }, { zc: siniestro }],
    });
    if (existente) {
      resumen.yaExistian += 1;
    } else {
      secuencial += 1;
      await BbvaCatCaso.create({
        ...payload,
        consecutivo: `BBVA-CAT-${año}-${mes}-${secuencial}`,
      });
      resumen.creados += 1;
      wfsNuevos.push(siniestro, nsiniestro);
    }

    const payloadListado = {
      zc: nsiniestro,
      siniestro,
      identificacion,
      tipoIdentificacion: payload.tipoIdentificacion,
      asegurado,
      ciudad: payload.ciudad,
      departamento: payload.departamento,
      telefonoAsegurado: payload.telefonoAsegurado,
      correoAsegurado: correo,
      contactoAsegurado: payload.informacionContacto,
      tipoPoliza: ramo.tipoPoliza,
      tipoPolizaOtro: ramo.tipoPolizaOtro || undefined,
      causa: payload.causa,
      estado: homologarEstadoBbvaCat('CASO NUEVO'),
      fechaCasoNuevo: payload.fechaCasoNuevo,
      observaciones: direccionPredio || '',
      valorAseguradoInmueble: payload.valorAseguradoInmueble || undefined,
      valorReclamado: payload.valorReclamado || undefined,
      valorEstimadoAseguradora: payload.valorEstimadoAseguradora || undefined,
    };
    const existenteListado = await BbvaCatListadoCaso.findOne({
      $or: [{ zc: nsiniestro }, { siniestro }, { zc: siniestro }, { siniestro: nsiniestro }],
    });
    if (existenteListado) {
      resumen.listadoYaExistian += 1;
    } else {
      secuencialListado += 1;
      await BbvaCatListadoCaso.create({
        ...payloadListado,
        consecutivo: `BBVA-CAT-LST-${año}-${mes}-${secuencialListado}`,
      });
      resumen.listadoCreados += 1;
    }
  }

  const wfs = [...new Set(wfsNuevos.filter(Boolean))];
  const geo = wfs.length ? await geocodeNuevos(wfs) : { evaluados: 0, ok: 0, failed: 0, sinDireccion: 0, yaOk: 0 };
  const asignacion = await persistirAsignacionBloquesNuevosBbvaCat({ radioKm: 5 });

  console.log(
    JSON.stringify(
      {
        archivo: excelPath,
        freeze,
        importacion: resumen,
        geocodeNuevos: geo,
        asignacion,
        catTotal: await BbvaCatCaso.countDocuments(),
        listadoTotal: await BbvaCatListadoCaso.countDocuments(),
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
