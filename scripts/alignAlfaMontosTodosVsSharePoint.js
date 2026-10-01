/**
 * Alinea TODA la base ARNALD ↔ consolidado:
 * 1) SID / inmueble / contenidos (verdes N–P): Excel → ARNALD
 * 2) Montos amarillos con diff: ARNALD → Excel (cola + flush)
 *
 *   node scripts/alignAlfaMontosTodosVsSharePoint.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { downloadDriveItemBuffer } from '../services/microsoftGraphService.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import {
  findExcelRowForCase,
  forceEnqueueAlfaExcelOutboundCases,
  flushAlfaExcelOutboundManual,
  getAlfaExcelOutboundQueueStats,
} from '../services/alfaExcelOutboundService.js';

const ASEG = [
  { field: 'valorAseguradoSid', col: 14, enc: 'valorAseguradoSid' },
  { field: 'valorAseguradoInmueble', col: 15, enc: 'valorAseguradoInmueble' },
  { field: 'valorAseguradoContenidos', col: 16, enc: 'valorAseguradoContenidos' },
];

const MONEY = [
  { field: 'valorReservaPreventivaPromedio', col: 20 },
  { field: 'valorComercialInmueble', col: 21 },
  { field: 'reserva', col: 22 },
  { field: 'valorReclamado', col: 23 },
  { field: 'valorLiquidado', col: 24 },
  { field: 'liquidadoCoberturaTerremo', col: 25 },
  { field: 'deducibleTerremoto', col: 26 },
  { field: 'valorLiquidacionCoberturasAdicionales', col: 27 },
  { field: 'deducibleCoberturasAdicionales', col: 28 },
  { field: 'valorTotalPagar', col: 29 },
];

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
console.log('Excel:', src.fileName);

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
      ...ASEG.map((c) => c.field),
      ...MONEY.map((c) => c.field),
    ].join(' ')
  )
  .lean();

console.log('casos', casos.length, 'filasExcel', rows.length);

let asegFixed = 0;
const moneyCaseIds = [];
let sinFila = 0;

for (const c of casos) {
  let hit;
  try {
    hit = findExcelRowForCase(c, rows);
  } catch {
    sinFila += 1;
    continue;
  }
  const excelRow = ws.getRow(hit.rowNumber);
  const patch = {};
  const enc = c.liquidador?.encabezado || {};

  for (const meta of ASEG) {
    const ar = pesos(c[meta.field]);
    const ex = cell(excelRow.getCell(meta.col).value);
    if (!igual(ar, ex)) {
      patch[meta.field] = ex;
      if (c.liquidador?.encabezado) {
        patch[`liquidador.encabezado.${meta.enc}`] = ex;
      }
    } else if (c.liquidador?.encabezado && !igual(pesos(enc[meta.enc]), ex)) {
      patch[`liquidador.encabezado.${meta.enc}`] = ex;
    }
  }

  if (Object.keys(patch).length) {
    await SegurosAlfaCaso.updateOne({ _id: c._id }, { $set: patch });
    asegFixed += 1;
  }

  let moneyDiff = false;
  for (const meta of MONEY) {
    const ar = pesos(c[meta.field]);
    const ex = cell(excelRow.getCell(meta.col).value);
    if (!igual(ar, ex)) {
      moneyDiff = true;
      break;
    }
  }
  if (moneyDiff) moneyCaseIds.push(c._id);
}

console.log({ asegFixed, moneyDiffCases: moneyCaseIds.length, sinFila });

await AlfaExcelOutboundUpdate.updateMany(
  { status: { $in: ['processing', 'failed'] } },
  {
    $set: {
      status: 'pending',
      attempts: 0,
      nextRetryAt: new Date(),
      lastError: null,
      lastErrorCode: null,
    },
  }
);

if (moneyCaseIds.length) {
  // lotes de hasta 500
  for (let i = 0; i < moneyCaseIds.length; i += 500) {
    const slice = moneyCaseIds.slice(i, i + 500);
    const enq = await forceEnqueueAlfaExcelOutboundCases({
      caseIds: slice,
      limit: slice.length,
      diffAgainstExcel: true,
      excelRows: rows,
    });
    console.log('enqueue lote', i / 500 + 1, enq);
  }
}

let queue = await getAlfaExcelOutboundQueueStats();
console.log('cola tras enqueue', queue);

let round = 0;
while (queue.total > 0 && round < 80) {
  round += 1;
  const flush = await flushAlfaExcelOutboundManual({ maxRounds: 3, batchSize: 12 });
  queue = await getAlfaExcelOutboundQueueStats();
  console.log(`flush ${round}`, { flush, queue });
  if (!(flush.claimed > 0) && queue.processing === 0 && !(queue.pending > 0)) break;
  if (!(flush.claimed > 0) && queue.processing > 0) {
    await AlfaExcelOutboundUpdate.updateMany(
      { status: 'processing' },
      { $set: { status: 'pending', nextRetryAt: new Date() } }
    );
    queue = await getAlfaExcelOutboundQueueStats();
  }
}

console.log('cola final', await getAlfaExcelOutboundQueueStats());
await mongoose.disconnect();
process.exit(0);
