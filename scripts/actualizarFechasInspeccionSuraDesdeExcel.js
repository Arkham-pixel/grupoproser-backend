/**
 * Actualiza SOLO fechaInspeccion / fchaInspccion en casos SURA
 * desde C:/Users/GP-TI/Downloads/FECHA DE INSPECCION.xlsx
 *
 * Uso:
 *   node scripts/actualizarFechasInspeccionSuraDesdeExcel.js           # dry-run
 *   node scripts/actualizarFechasInspeccionSuraDesdeExcel.js --apply   # escribe
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import mongoose from 'mongoose';
import SegurosSuraCaso from '../models/SegurosSuraCaso.js';

const APPLY = process.argv.includes('--apply');
const EXCEL =
  process.env.EXCEL_INSPECCION ||
  'C:/Users/GP-TI/Downloads/FECHA DE INSPECCION.xlsx';

function digits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

/** dd/mm/yyyy, mm/dd/yy o Date → Date local mediodía */
function parseFechaInspeccion(valor) {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return new Date(valor.getFullYear(), valor.getMonth(), valor.getDate(), 12, 0, 0, 0);
  }
  const s = String(valor).trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    let day;
    let mo;
    // Si el segundo > 12 → mm/dd (ej. 8/15/26). Si el primero > 12 → dd/mm.
    // Si ambos <= 12 → dd/mm (formato Colombia del archivo).
    if (b > 12 && a >= 1 && a <= 12) {
      mo = a;
      day = b;
    } else {
      day = a;
      mo = b;
    }
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
    return new Date(y, mo - 1, day, 12, 0, 0, 0);
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0, 0);
  }
  return null;
}

function leerExcel(ruta) {
  if (!fs.existsSync(ruta)) throw new Error(`No existe el archivo: ${ruta}`);
  const wb = XLSX.readFile(ruta, { cellDates: true, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  // Fila0 título, fila1 encabezados FECHA VISITA | RECLAMACIÓN
  const porRec = new Map(); // rec -> { fechaStr, fechaDate, fuente }
  const vacias = [];
  const invalidas = [];

  for (let i = 2; i < matriz.length; i += 1) {
    const row = matriz[i] || [];
    const fechaStr = String(row[0] ?? '').trim();
    const rec = digits(row[1]);
    if (rec.length < 10) {
      if (fechaStr || String(row[1] ?? '').trim()) {
        invalidas.push({ fila: i + 1, reclamacion: row[1], fecha: fechaStr });
      }
      continue;
    }
    if (!fechaStr) {
      vacias.push(rec);
      continue;
    }
    const fechaDate = parseFechaInspeccion(fechaStr);
    if (!fechaDate) {
      invalidas.push({ fila: i + 1, reclamacion: rec, fecha: fechaStr });
      continue;
    }
    // Si hay varias filas del mismo siniestro, gana la PRIMERA fecha válida
    // (la de inspección real; no la última ni posibles typos posteriores).
    if (!porRec.has(rec)) {
      porRec.set(rec, { fechaStr, fechaDate, fila: i + 1 });
    }
  }

  return { porRec, vacias, invalidas };
}

function isoDia(d) {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

await mongoose.connect(process.env.MONGO_URI);
const { porRec, vacias, invalidas } = leerExcel(EXCEL);

console.log('=== FECHA DE INSPECCION → SURA ===');
console.log('Archivo:', EXCEL);
console.log('Modo:', APPLY ? 'APPLY (escribe BD)' : 'DRY-RUN (no escribe)');
console.log('Siniestros con fecha en Excel:', porRec.size);
console.log('Filas sin fecha (se omiten, no se borran fechas):', vacias.length);
console.log('Filas inválidas:', invalidas.length);
if (invalidas.length) console.log(invalidas.slice(0, 10));

const casos = await SegurosSuraCaso.find({
  siniestro: { $exists: true, $nin: [null, ''] },
})
  .select('_id siniestro consecutivo fechaInspeccion fchaInspccion estado')
  .lean();

const porCaso = new Map(); // rec -> casos[]
for (const c of casos) {
  const rec = digits(c.siniestro);
  if (rec.length < 10) continue;
  if (!porCaso.has(rec)) porCaso.set(rec, []);
  porCaso.get(rec).push(c);
}

const actualizados = [];
const sinCambio = [];
const noEncontrados = [];
const ops = [];

for (const [rec, info] of porRec) {
  const lista = porCaso.get(rec) || [];
  if (!lista.length) {
    noEncontrados.push({ reclamacion: rec, fecha: info.fechaStr });
    continue;
  }
  const despues = isoDia(info.fechaDate);
  for (const caso of lista) {
    const antes = isoDia(caso.fechaInspeccion || caso.fchaInspccion);
    if (antes === despues) {
      sinCambio.push({ reclamacion: rec, consecutivo: caso.consecutivo, fecha: despues });
      continue;
    }
    actualizados.push({
      reclamacion: rec,
      consecutivo: caso.consecutivo,
      id: String(caso._id),
      antes: antes || '(vacío)',
      despues,
    });
    ops.push({
      updateOne: {
        filter: { _id: caso._id },
        update: {
          $set: {
            fechaInspeccion: info.fechaDate,
            fchaInspccion: info.fechaDate,
          },
        },
      },
    });
  }
}

console.log('\n--- Resumen ---');
console.log('A actualizar:', actualizados.length);
console.log('Sin cambio (ya igual):', sinCambio.length);
console.log('No encontrados en SURA:', noEncontrados.length);
console.log('\nMuestra actualizaciones:');
console.log(JSON.stringify(actualizados.slice(0, 15), null, 2));
if (noEncontrados.length) {
  console.log('\nNo encontrados:');
  console.log(JSON.stringify(noEncontrados, null, 2));
}

if (APPLY && ops.length) {
  const result = await SegurosSuraCaso.bulkWrite(ops, { ordered: false });
  console.log('\nbulkWrite:', {
    matched: result.matchedCount,
    modified: result.modifiedCount,
  });
} else if (!APPLY) {
  console.log('\nDry-run OK. Ejecuta con --apply para guardar.');
}

const out = path.resolve('scripts/_out_fechas_inspeccion_sura.json');
fs.writeFileSync(
  out,
  JSON.stringify(
    { apply: APPLY, actualizados, sinCambio, noEncontrados, vaciasOmitidas: vacias.length },
    null,
    2
  )
);
console.log('Log:', out);

await mongoose.disconnect();
