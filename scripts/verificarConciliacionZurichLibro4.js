/**
 * Verifica Libro4 (conciliación Zurich DATA / Angel) vs aplicativo.
 * Cruza NSINIESTRO contra BBVA CAT y Zurich.
 *
 *   node scripts/verificarConciliacionZurichLibro4.js
 *   node scripts/verificarConciliacionZurichLibro4.js "C:\\Users\\GP-TI\\Downloads\\Libro4.xlsx"
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import fs from 'fs';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';
import ZurichCaso from '../models/ZurichCaso.js';
import ZurichListadoCaso from '../models/ZurichListadoCaso.js';
import { homologarEstadoBbvaCat } from '../utils/estadosBbvaCat.js';
import { homologarEstadoZurich } from '../utils/estadosZurich.js';

const EXCEL_DEFAULT = 'C:\\Users\\GP-TI\\Downloads\\Libro4.xlsx';

const str = (v) => String(v ?? '').trim();
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const normKey = (raw) =>
  str(raw)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ');

function mapEstadoBbva(raw) {
  const k = normKey(raw);
  const map = {
    'INSPECCION AGENDADA': 'COORDINANDO INSPECCIÓN',
    'COORDINANDO INSPECCION': 'COORDINANDO INSPECCIÓN',
    'CASO NUEVO': 'CASO NUEVO',
    'ANALISIS DEL CASO': 'ANÁLISIS DEL CASO',
    'PENDIENTE DE DOCUMENTO': 'PENDIENTE DE DOCUMENTO',
    'PENDIENTE DOCUMENTOS': 'PENDIENTE DE DOCUMENTO',
    OBJECION: 'OBJECIÓN',
    OBJETADO: 'OBJETADO',
    'AUTORIZACION ANALISTA': 'AUTORIZACIÓN ANALISTA',
    'CASO AJUSTADO': 'CASO AJUSTADO',
    'CASO PARA PAGO': 'CASO PARA PAGO',
    PAGADO: 'PAGADO',
    DESISTIMIENTO: 'DESISTIMIENTO',
  };
  return map[k] || homologarEstadoBbvaCat(raw) || str(raw);
}

function mapEstadoZurich(raw) {
  const k = normKey(raw);
  const map = {
    'INSPECCION AGENDADA': 'INSPECCIÓN COORDINADA',
    'INSPECCION COORDINADA': 'INSPECCIÓN COORDINADA',
    'COORDINANDO INSPECCION': 'INSPECCIÓN COORDINADA',
    'CASO NUEVO': 'CASO NUEVO',
    ASIGNADO: 'ASIGNADO',
    'ANALISIS DEL CASO': 'ANALISIS DEL CASO',
    'PENDIENTE DOCUMENTOS': 'PENDIENTE DOCUMENTOS (INFORME PRELIMINAR)',
    FINALIZADO: 'FINALIZADO',
  };
  return map[k] || homologarEstadoZurich(raw) || str(raw);
}

function leerExcel(file) {
  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerIdx = matrix.findIndex((r) => str(r?.[0]).toUpperCase() === 'NSINIESTRO');
  if (headerIdx < 0) throw new Error('No se encontró fila de encabezados (NSINIESTRO).');
  const headers = matrix[headerIdx].map((h) => str(h));
  const rows = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const line = matrix[i];
    if (!line || !line.some((c) => str(c))) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = line[idx];
    });
    const siniestro = str(obj.NSINIESTRO);
    if (!siniestro || !/^\d+$/.test(siniestro)) continue;
    rows.push({
      siniestro,
      estadoReclamo: str(obj['ESTADO RECLAMO']),
      estadoAjustador: str(obj['Estado ajustador']),
      sugeridoBbva: mapEstadoBbva(obj['Estado ajustador']),
      sugeridoZurich: mapEstadoZurich(obj['Estado ajustador']),
      asegurado: str(obj['Nombre Asegurado']),
      ciudad: str(obj['Ciudad Nombre'] || obj.CIUDAD),
      correo: str(obj.Correo),
      valorAsegurableInmueble: num(obj['Valor Asegurable Inmueble']),
      perdidaTotal: num(obj['Perdida Total']),
      valorIndemnizado: num(obj['Valor Indemnizado total']),
      cuantiaProbable: num(obj['VR CUANTIA PROBABLE']),
    });
  }
  return rows;
}

function indexar(docs) {
  const m = new Map();
  for (const d of docs) {
    const k = str(d.siniestro || d.zc);
    if (k) m.set(k, d);
  }
  return m;
}

function almostEq(a, b, tol = 1) {
  if (a == null || b == null || b === '') return false;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function cruzarModulo({ nombre, excelRows, docsCat, docsList, homologar, sugeridoKey }) {
  const catBy = indexar(docsCat);
  const listBy = indexar(docsList);
  const estadoExcel = {};
  const estadoAppCat = {};
  const estadoAppList = {};
  let matchCat = 0;
  let matchList = 0;
  let sinCat = 0;
  let sinList = 0;
  let diffEstadoCat = 0;
  let diffEstadoList = 0;
  let diffValor = 0;
  const sampleSin = [];
  const sampleDiffEstado = [];
  const sampleDiffValor = [];

  for (const row of excelRows) {
    estadoExcel[row.estadoAjustador || '(vacío)'] =
      (estadoExcel[row.estadoAjustador || '(vacío)'] || 0) + 1;
    const sugerido = row[sugeridoKey];
    const cat = catBy.get(row.siniestro);
    const list = listBy.get(row.siniestro);

    if (!cat) {
      sinCat += 1;
      if (sampleSin.length < 12) sampleSin.push(row.siniestro);
    } else {
      matchCat += 1;
      const est = homologar(cat.estado);
      estadoAppCat[est] = (estadoAppCat[est] || 0) + 1;
      if (est !== sugerido) {
        diffEstadoCat += 1;
        if (sampleDiffEstado.length < 15) {
          sampleDiffEstado.push({
            siniestro: row.siniestro,
            excel: row.estadoAjustador,
            sugerido,
            app: est,
          });
        }
      }
      if (
        row.valorAsegurableInmueble != null &&
        Number(cat.valorAseguradoInmueble) > 0 &&
        !almostEq(row.valorAsegurableInmueble, cat.valorAseguradoInmueble, 1)
      ) {
        diffValor += 1;
        if (sampleDiffValor.length < 8) {
          sampleDiffValor.push({
            siniestro: row.siniestro,
            excel: row.valorAsegurableInmueble,
            app: cat.valorAseguradoInmueble,
          });
        }
      }
    }

    if (!list) sinList += 1;
    else {
      matchList += 1;
      const est = homologar(list.estado);
      estadoAppList[est] = (estadoAppList[est] || 0) + 1;
      if (est !== sugerido) diffEstadoList += 1;
    }
  }

  return {
    modulo: nombre,
    matchCat,
    matchList,
    sinCat,
    sinList,
    coberturaCatPct: Number(((matchCat / excelRows.length) * 100).toFixed(1)),
    coberturaListadoPct: Number(((matchList / excelRows.length) * 100).toFixed(1)),
    estadosExcel_EstadoAjustador: estadoExcel,
    estadosAppCat: estadoAppCat,
    estadosAppListado: estadoAppList,
    diffEstadoCat,
    diffEstadoListado: diffEstadoList,
    diffValorInmueble: diffValor,
    sampleSinCaso: sampleSin,
    sampleDiffEstado,
    sampleDiffValor,
  };
}

async function main() {
  const file = process.argv[2] || EXCEL_DEFAULT;
  if (!fs.existsSync(file)) throw new Error(`No existe: ${file}`);
  const excelRows = leerExcel(file);
  const sins = excelRows.map((r) => r.siniestro);

  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);
  const filtro = { $or: [{ siniestro: { $in: sins } }, { zc: { $in: sins } }] };
  const select =
    'siniestro zc estado asegurado valorAseguradoInmueble valorReclamado valorLiquidado';

  const [bbvaCat, bbvaList, zurichCat, zurichList] = await Promise.all([
    BbvaCatCaso.find(filtro).select(select).lean(),
    BbvaCatListadoCaso.find(filtro).select(select).lean(),
    ZurichCaso.find(filtro).select(select).lean(),
    ZurichListadoCaso.find(filtro).select(select).lean(),
  ]);

  const resumenBbva = cruzarModulo({
    nombre: 'BBVA CAT',
    excelRows,
    docsCat: bbvaCat,
    docsList: bbvaList,
    homologar: homologarEstadoBbvaCat,
    sugeridoKey: 'sugeridoBbva',
  });
  const resumenZurich = cruzarModulo({
    nombre: 'Zurich',
    excelRows,
    docsCat: zurichCat,
    docsList: zurichList,
    homologar: homologarEstadoZurich,
    sugeridoKey: 'sugeridoZurich',
  });

  console.log(
    JSON.stringify(
      {
        archivo: file,
        filasExcel: excelRows.length,
        bbva: resumenBbva,
        zurich: resumenZurich,
        lectura: 'El Excel de Angel (Zurich DATA) usa NSINIESTRO tipo BBVA; Estado ajustador≈inspección.',
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
