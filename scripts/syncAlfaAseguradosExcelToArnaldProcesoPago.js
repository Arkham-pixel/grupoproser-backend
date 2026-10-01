/**
 * Alinea valorAseguradoSid / Inmueble / Contenidos de PROCESO DE PAGO
 * al consolidado SharePoint (Excel manda). Sin outbound (columnas verdes).
 *
 *   node scripts/syncAlfaAseguradosExcelToArnaldProcesoPago.js --dry-run
 *   node scripts/syncAlfaAseguradosExcelToArnaldProcesoPago.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { downloadDriveItemBuffer } from '../services/microsoftGraphService.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import { findExcelRowForCase } from '../services/alfaExcelOutboundService.js';

const DRY = process.argv.includes('--dry-run');

const CAMPOS = [
  { field: 'valorAseguradoSid', col: 14, enc: 'valorAseguradoSid' },
  { field: 'valorAseguradoInmueble', col: 15, enc: 'valorAseguradoInmueble' },
  { field: 'valorAseguradoContenidos', col: 16, enc: 'valorAseguradoContenidos' },
];

function isPP(e) {
  return String(e || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .includes('PROCESO DE PAGO');
}

function cell(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw === 'object' && raw.result != null) return cell(raw.result);
  if (typeof raw === 'object' && raw.richText) {
    return cell(raw.richText.map((t) => t.text).join(''));
  }
  let s = String(raw).trim().replace(/[$\s]/g, '');
  if (!s || s === '-' || s === '—') return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function pesos(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function igual(a, b) {
  return (a == null ? 0 : a) === (b == null ? 0 : b);
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
});

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
if (!src?.itemId) {
  console.error('No SharePoint source');
  process.exit(1);
}

console.log(DRY ? 'DRY-RUN' : 'APPLY', src.fileName);

const dl = await downloadDriveItemBuffer({ driveId: src.driveId, itemId: src.itemId });
const buffer = dl.buffer || dl;
const rows = parseAlfaExcelBuffer(buffer).rows || [];
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);
const ws = wb.worksheets[0];

const casos = await SegurosAlfaCaso.find({ excluidoBaseAlfa: { $ne: true } })
  .select(
    [
      'consecutivo',
      'identificacion',
      'asegurado',
      'estado',
      'numeroCredito',
      'numeroPoliza',
      'direccionPredio',
      'siniestro',
      'liquidador.encabezado',
      ...CAMPOS.map((c) => c.field),
    ].join(' ')
  )
  .lean();

const pago = casos.filter((c) => isPP(c.estado));
console.log('procesoPago', pago.length);

const changes = [];
let sinFila = 0;

for (const c of pago) {
  let hit;
  try {
    hit = findExcelRowForCase(c, rows);
  } catch {
    sinFila += 1;
    continue;
  }
  const excelRow = ws.getRow(hit.rowNumber);
  const patch = {};
  const before = {};
  const after = {};
  const enc = c.liquidador?.encabezado || {};

  for (const meta of CAMPOS) {
    const ar = pesos(c[meta.field]);
    const ex = cell(excelRow.getCell(meta.col).value);
    if (igual(ar, ex)) {
      // igual en plano; revisar encabezado liquidador
      if (c.liquidador?.encabezado && !igual(pesos(enc[meta.enc]), ex)) {
        patch[`liquidador.encabezado.${meta.enc}`] = ex;
        before[`liq_${meta.field}`] = enc[meta.enc];
        after[`liq_${meta.field}`] = ex;
      }
      continue;
    }
    // Excel manda: null/vacío → null en Mongo
    patch[meta.field] = ex;
    before[meta.field] = ar;
    after[meta.field] = ex;
    if (c.liquidador?.encabezado) {
      patch[`liquidador.encabezado.${meta.enc}`] = ex;
      before[`liq_${meta.field}`] = enc[meta.enc];
      after[`liq_${meta.field}`] = ex;
    }
  }

  if (!Object.keys(patch).length) continue;
  changes.push({
    consecutivo: c.consecutivo,
    identificacion: c.identificacion,
    excelFila: hit.rowNumber,
    before,
    after,
    patch,
    _id: c._id,
  });
}

console.log('a corregir', changes.length, 'sinFila', sinFila);
for (const ch of changes.slice(0, 50)) {
  console.log(
    JSON.stringify({
      consecutivo: ch.consecutivo,
      fila: ch.excelFila,
      before: ch.before,
      after: ch.after,
    })
  );
}

if (!DRY) {
  for (const ch of changes) {
    await SegurosAlfaCaso.updateOne({ _id: ch._id }, { $set: ch.patch });
  }
}

console.log(JSON.stringify({ DRY, procesoPago: pago.length, corregidos: changes.length, sinFila }, null, 2));
await mongoose.disconnect();
process.exit(0);
