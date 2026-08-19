/**
 * Restaura ajustadores Alfa desde un CSV/TSV: consecutivo,ajustador
 * o identificacion,ajustador
 *
 * Uso:
 *   node scripts/restoreAjustadoresAlfaDesdeCsv.js ruta/archivo.csv
 *   DRY_RUN=false node scripts/restoreAjustadoresAlfaDesdeCsv.js ruta/archivo.csv
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';

const DRY = String(process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/restoreAjustadoresAlfaDesdeCsv.js archivo.csv');
  process.exit(1);
}

const raw = fs.readFileSync(path.resolve(file), 'utf8');
const lines = raw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);
if (lines.length < 2) {
  console.error('CSV vacío');
  process.exit(1);
}

const sep = lines[0].includes(';') ? ';' : ',';
const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());
const idxCons = headers.findIndex((h) => /consecutivo/.test(h));
const idxId = headers.findIndex((h) => /identific/.test(h));
const idxAj = headers.findIndex((h) => /ajustador|responsable/.test(h));
if (idxAj < 0 || (idxCons < 0 && idxId < 0)) {
  console.error('Se necesitan columnas: consecutivo (o identificacion) + ajustador');
  process.exit(1);
}

const rows = [];
for (let i = 1; i < lines.length; i += 1) {
  const cols = lines[i].split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  const ajustador = cols[idxAj] || '';
  if (!ajustador) continue;
  rows.push({
    consecutivo: idxCons >= 0 ? cols[idxCons] : '',
    identificacion: idxId >= 0 ? cols[idxId] : '',
    ajustador,
  });
}

await mongoose.connect(process.env.MONGO_URI);
const col = mongoose.connection.db.collection('gsk3cAppsegurosAlfaCasos');

let matched = 0;
let updated = 0;
const missing = [];
for (const r of rows) {
  const filtro = r.consecutivo
    ? { consecutivo: r.consecutivo }
    : { identificacion: r.identificacion };
  const doc = await col.findOne(filtro, { projection: { consecutivo: 1, ajustador: 1 } });
  if (!doc) {
    missing.push(r);
    continue;
  }
  matched += 1;
  if (DRY) continue;
  const res = await col.updateOne(
    { _id: doc._id },
    { $set: { ajustador: r.ajustador, updatedAt: new Date() } }
  );
  if (res.modifiedCount) updated += 1;
}

console.log(
  JSON.stringify(
    {
      dryRun: DRY,
      filasCsv: rows.length,
      matched,
      updated,
      missing: missing.slice(0, 20),
      missingCount: missing.length,
    },
    null,
    2
  )
);
if (DRY) console.log('DRY_RUN: no se escribió nada. Ejecuta con DRY_RUN=false para aplicar.');
await mongoose.disconnect();
