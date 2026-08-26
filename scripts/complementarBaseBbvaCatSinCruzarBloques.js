/**
 * Complementa la base BBVA CAT con un Excel BASE BBVA sin tocar bloques fijos.
 *
 * 1) Congela bloques actuales (5 km) si aún no están fijos
 * 2) Crea solo siniestros nuevos en CAT + listado (no pisa existentes)
 * 3) Geocodifica únicamente los nuevos
 * 4) Asigna nuevos al bloque fijo más cercano o a bloques N+1 sin cruzar
 *
 * Uso:
 *   node scripts/complementarBaseBbvaCatSinCruzarBloques.js
 *   node scripts/complementarBaseBbvaCatSinCruzarBloques.js "C:\\ruta\\Libro1.xlsx"
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const excelPath =
  process.argv[2] ||
  path.join(__dirname, '_tmp_libro1_bbva.xlsx');

const leerWfs = () => {
  const wb = XLSX.readFile(excelPath, { cellDates: true });
  const hoja = wb.SheetNames.find((n) => /BASE BBVA/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, defval: '' });
  return rows
    .slice(2)
    .map((r) => String(r[0] || '').trim())
    .filter(Boolean);
};

const correrImport = () =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'importarBaseBbvaLibro1.js'), excelPath], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err || out || `import exit ${code}`));
        return;
      }
      resolve(out);
    });
  });

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
      caso.ubicacionPredio = {
        ...(caso.ubicacionPredio?.toObject?.() || caso.ubicacionPredio || {}),
        geocodeStatus: 'sin_direccion',
        geocodeQuery: query,
        direccionHash: hash,
        geocodedAt: new Date(),
        lat: undefined,
        lng: undefined,
      };
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
      caso.set('ubicacionPredio.geocodeStatus', geo.status === 'sin_direccion' ? 'sin_direccion' : 'failed');
      caso.set('ubicacionPredio.geocodeQuery', query);
      caso.set('ubicacionPredio.direccionHash', hash);
      caso.set('ubicacionPredio.geocodedAt', new Date());
      caso.set('ubicacionPredio.locationType', geo.locationType || '');
      caso.set('ubicacionPredio.formattedAddress', geo.formattedAddress || '');
      caso.set('ubicacionPredio.lat', undefined);
      caso.set('ubicacionPredio.lng', undefined);
      await caso.save();
      if (geo.status === 'sin_direccion') resumen.sinDireccion += 1;
      else resumen.failed += 1;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return resumen;
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error('Falta MONGO_URI');
  const wfs = leerWfs();
  await mongoose.connect(process.env.MONGO_URI);

  const freeze = await fijarBloquesCercaniaBbvaCat({ radioKm: 5, forzar: false });
  const importOut = await correrImport();
  let importJson = null;
  try {
    importJson = JSON.parse(importOut);
  } catch {
    importJson = { raw: importOut };
  }
  const geo = await geocodeNuevos(wfs);
  const asignacion = await persistirAsignacionBloquesNuevosBbvaCat({ radioKm: 5 });

  const fijos = await BbvaCatCaso.aggregate([
    { $match: { 'bloqueCercania.fijo': true } },
    { $group: { _id: '$bloqueCercania.numero', n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  console.log(
    JSON.stringify(
      {
        archivo: excelPath,
        wfsExcel: wfs.length,
        freeze,
        importacion: importJson,
        geocodeNuevos: geo,
        asignacion,
        bloquesFijos: fijos.map((x) => ({ bloque: x._id, casos: x.n })),
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
