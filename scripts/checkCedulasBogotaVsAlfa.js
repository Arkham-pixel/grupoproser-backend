/**
 * Cruza cédulas del Excel Bogotá vs casos Alfa.
 *   node scripts/checkCedulasBogotaVsAlfa.js
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { normalizeIdentification } from '../utils/alfaIdentification.js';

const SRC = path.join(
  process.env.USERPROFILE || '',
  'Downloads',
  'CONFIRMACIÓN DATOS BANCO DE BOGOTÁ.xlsx'
);

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
});

const wb = XLSX.readFile(SRC);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

const excelById = new Map();
for (const r of rows) {
  const id = normalizeIdentification(r['IDENTIFICACIÓN'] ?? r.IDENTIFICACION ?? r.identificacion);
  if (!id) continue;
  if (!excelById.has(id)) excelById.set(id, []);
  excelById.get(id).push({
    asegurado: String(r.ASEGURADO || '').trim(),
    tomador: String(r.TOMADOR || '').trim(),
    credito: String(r['N CRÉDITO'] || r['N CREDITO'] || '').trim(),
    poliza: String(r['N° PÓLIZA'] || r['N POLIZA'] || '').trim(),
    ciudad: String(r.CIUDAD || '').trim(),
  });
}

const alfa = await SegurosAlfaCaso.find({ excluidoBaseAlfa: { $ne: true } })
  .select('consecutivo identificacion asegurado estado estadoGestion tomador numeroCredito numeroPoliza')
  .lean();

const alfaById = new Map();
for (const c of alfa) {
  const id = normalizeIdentification(c.identificacion);
  if (!id) continue;
  if (!alfaById.has(id)) alfaById.set(id, []);
  alfaById.get(id).push(c);
}

const resultado = [];
let si = 0;
let no = 0;
for (const [id, excelRows] of [...excelById.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const casos = alfaById.get(id) || [];
  const enAlfa = casos.length > 0;
  if (enAlfa) si += 1;
  else no += 1;
  for (const er of excelRows) {
    resultado.push({
      identificacion: id,
      aseguradoExcel: er.asegurado,
      tomadorExcel: er.tomador,
      creditoExcel: er.credito,
      polizaExcel: er.poliza,
      ciudadExcel: er.ciudad,
      enAlfa: enAlfa ? 'SI' : 'NO',
      nCasosAlfa: casos.length,
      consecutivosAlfa: casos.map((c) => c.consecutivo).join(' | '),
      aseguradosAlfa: [...new Set(casos.map((c) => c.asegurado).filter(Boolean))].join(' | '),
      estadosAlfa: casos.map((c) => `${c.consecutivo}:${c.estado || ''}/${c.estadoGestion || ''}`).join(' | '),
    });
  }
}

const outDir = path.join(process.cwd(), 'scripts', '_out');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'cedulas-bogota-vs-alfa.xlsx');
const outWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  outWb,
  XLSX.utils.json_to_sheet([
    { clave: 'archivo', valor: SRC },
    { clave: 'filasExcel', valor: rows.length },
    { clave: 'cedulasUnicasExcel', valor: excelById.size },
    { clave: 'cedulasEnAlfa', valor: si },
    { clave: 'cedulasNOEnAlfa', valor: no },
    { clave: 'generado', valor: new Date().toISOString() },
  ]),
  'Meta'
);
XLSX.utils.book_append_sheet(outWb, XLSX.utils.json_to_sheet(resultado), 'Cruce');
XLSX.utils.book_append_sheet(
  outWb,
  XLSX.utils.json_to_sheet(resultado.filter((r) => r.enAlfa === 'SI')),
  'EnAlfa'
);
XLSX.utils.book_append_sheet(
  outWb,
  XLSX.utils.json_to_sheet(resultado.filter((r) => r.enAlfa === 'NO')),
  'NoEnAlfa'
);
XLSX.writeFile(outWb, outPath);

const desk = path.join(process.env.USERPROFILE || '', 'Desktop', 'cedulas-bogota-vs-alfa.xlsx');
try {
  fs.copyFileSync(outPath, desk);
} catch {
  /* */
}

console.log(
  JSON.stringify(
    {
      filasExcel: rows.length,
      cedulasUnicas: excelById.size,
      enAlfa: si,
      noEnAlfa: no,
      pctEnAlfa: excelById.size ? Math.round((si / excelById.size) * 1000) / 10 : 0,
      excel: desk,
      muestraNo: resultado.filter((r) => r.enAlfa === 'NO').slice(0, 15),
      muestraSi: resultado.filter((r) => r.enAlfa === 'SI').slice(0, 10),
    },
    null,
    2
  )
);

await mongoose.disconnect();
