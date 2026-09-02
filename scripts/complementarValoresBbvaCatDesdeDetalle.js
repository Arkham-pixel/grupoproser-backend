/**
 * Completa valores de la aseguradora en CAT desde Libro1 Detalle1.
 * Solo llena huecos de inmueble/contenidos/reclamado. No copia cuantía probable a reserva
 * ni indemnizado a liquidado (eso es gestión Proser).
 *
 * Uso:
 *   node scripts/complementarValoresBbvaCatDesdeDetalle.js "C:\\ruta\\Libro1.xlsx"
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import BbvaCatCaso from '../models/BbvaCatCaso.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const excelPath =
  process.argv[2] || path.join(__dirname, '_tmp_libro1_valores.xlsx');

const toTxt = (valor) => {
  if (valor === null || valor === undefined || valor === '') return '';
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    if (Math.abs(valor) >= 1e15) return String(valor);
    return String(Math.round(valor) === valor ? Math.round(valor) : valor);
  }
  return String(valor).replace(/\t/g, ' ').replace(/\r/g, ' ').replace(/\s+/g, ' ').trim();
};

const parseMoney = (valor) => {
  const t = toTxt(valor).replace(/[^0-9.,-]/g, '');
  if (!t || t === '-' || t === '.') return 0;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const esHueco = (valor) => {
  if (valor == null || valor === '') return true;
  const n = Number(valor);
  return !Number.isFinite(n) || n <= 0;
};

const llenarSiHueco = (caso, campo, monto, cambios) => {
  if (!(monto > 0) || !esHueco(caso[campo])) return;
  caso[campo] = monto;
  cambios[campo] = monto;
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);
  const wb = XLSX.readFile(excelPath, { cellDates: true, raw: false });
  const hoja =
    wb.SheetNames.find((n) => /detalle/i.test(n)) ||
    wb.SheetNames.find((n) => /BASE BBVA/i.test(n)) ||
    wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[hoja], {
    header: 1,
    defval: '',
    raw: false,
  });
  const headerIdx = rows.findIndex((r) => /^NSINIESTRO$/i.test(toTxt(r?.[0])));
  if (headerIdx < 0) throw new Error('No se encontró la fila NSINIESTRO');
  const data = rows.slice(headerIdx + 1).filter((r) => /^\d+$/.test(toTxt(r?.[0])));

  const porWf = new Map();
  for (const row of data) {
    const nsiniestro = toTxt(row[0]);
    const stroBbva = toTxt(row[5]);
    const valores = {
      valorAseguradoInmueble: parseMoney(row[32]),
      valorAseguradoContenidos: parseMoney(row[33]),
      valorReclamado: parseMoney(row[38]),
    };
    porWf.set(nsiniestro, valores);
    if (/^\d+$/.test(stroBbva)) porWf.set(stroBbva, valores);
  }

  const casos = await BbvaCatCaso.find({}).select(
    'zc siniestro valorAseguradoInmueble valorAseguradoContenidos valorReservaPreventivaPromedio valorComercialInmueble reserva valorReclamado valorLiquidado'
  );

  const resumen = {
    archivo: excelPath,
    hoja,
    filasExcel: data.length,
    casosCat: casos.length,
    actualizados: 0,
    sinMatch: 0,
    sinValoresNuevos: 0,
    campos: {
      valorAseguradoInmueble: 0,
      valorAseguradoContenidos: 0,
      valorReclamado: 0,
    },
  };

  for (const caso of casos) {
    const valores =
      porWf.get(toTxt(caso.zc)) ||
      porWf.get(toTxt(caso.siniestro));
    if (!valores) {
      resumen.sinMatch += 1;
      continue;
    }
    const cambios = {};
    // VR CUANTÍA PROBABLE (col 20) e indemnizado (col 40) no son reserva BBVA ni liquidado Proser.
    llenarSiHueco(caso, 'valorAseguradoInmueble', valores.valorAseguradoInmueble, cambios);
    llenarSiHueco(caso, 'valorAseguradoContenidos', valores.valorAseguradoContenidos, cambios);
    llenarSiHueco(caso, 'valorReclamado', valores.valorReclamado, cambios);
    const keys = Object.keys(cambios);
    if (!keys.length) {
      resumen.sinValoresNuevos += 1;
      continue;
    }
    await caso.save();
    resumen.actualizados += 1;
    for (const k of keys) resumen.campos[k] += 1;
  }

  const conReserva = await BbvaCatCaso.countDocuments({ reserva: { $gt: 0 } });
  const conInmueble = await BbvaCatCaso.countDocuments({
    valorAseguradoInmueble: { $gt: 0 },
  });

  console.log(
    JSON.stringify(
      {
        ...resumen,
        despues: { conReserva, conInmueble, total: await BbvaCatCaso.countDocuments() },
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
