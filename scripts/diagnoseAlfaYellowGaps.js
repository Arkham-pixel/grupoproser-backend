/**
 * Compara Mongo (campos amarillos) vs Excel BD para detectar gaps.
 * Solo lectura.
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { getOutboundWritableFields, getOwnershipEntry } from '../config/alfaExcelOwnershipMap.js';
import { parseAlfaExcelBuffer, matchAlfaCaseForExcelRow } from '../services/alfaExcelImportService.js';
import {
  downloadDriveItemBuffer,
  resolveDriveContext,
  createWorkbookSession,
  closeWorkbookSession,
  readWorkbookRange,
} from '../services/microsoftGraphService.js';
import { findExcelRowForCase } from '../services/alfaExcelOutboundService.js';
import ExcelJS from 'exceljs';

const FIELDS = getOutboundWritableFields();

function colNum(letter) {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function cellStr(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v.result != null) return String(v.result);
  if (typeof v === 'object' && v.text != null) return String(v.text);
  return String(v);
}

await mongoose.connect(process.env.MONGO_URI);
const cases = await SegurosAlfaCaso.find().lean();
const source = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
const ctx = await resolveDriveContext();
const dl = await downloadDriveItemBuffer({
  driveId: source.driveId || ctx.driveId,
  itemId: source.itemId,
});
const parsed = parseAlfaExcelBuffer(dl.buffer);
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(dl.buffer);
const ws = wb.getWorksheet(parsed.sheetName);

const gaps = [];
for (const c of cases) {
  // ¿tiene algún campo amarillo con valor en Mongo?
  const mongoVals = {};
  let hasYellow = false;
  for (const f of FIELDS) {
    const v = c[f];
    if (v != null && v !== '' && !(typeof v === 'number' && v === 0 && f !== 'valorLiquidado' && f !== 'valorReclamado' && f !== 'reserva')) {
      // incluir 0 si está explícito para montos
    }
    const empty =
      v == null ||
      v === '' ||
      (v instanceof Date && Number.isNaN(v.getTime()));
    if (!empty) {
      hasYellow = true;
      mongoVals[f] = v instanceof Date ? v.toISOString() : v;
    }
  }
  if (!hasYellow) continue;

  let hit = null;
  try {
    hit = findExcelRowForCase(c, parsed.rows);
  } catch (e) {
    gaps.push({
      consecutivo: c.consecutivo,
      id: String(c._id),
      problem: `MATCH_${e.code || e.message}`,
      mongoVals,
    });
    continue;
  }

  const excelVals = {};
  const missing = [];
  for (const f of Object.keys(mongoVals)) {
    const col = getOwnershipEntry(f).column;
    const cell = ws.getRow(hit.rowNumber).getCell(colNum(col));
    const excel = cellStr(cell.value);
    excelVals[`${col}/${f}`] = excel;
    const mongo = mongoVals[f];
    // compare loosely
    let ok = false;
    if (typeof mongo === 'number') {
      const n = typeof cell.value === 'number' ? cell.value : Number(String(excel || '').replace(/[^\d.-]/g, ''));
      ok = Number.isFinite(n) && Math.abs(n - mongo) < 0.01;
    } else if (typeof mongo === 'string' && mongo.includes('T')) {
      // date iso
      const day = mongo.slice(0, 10);
      ok = excel && (excel.includes(day) || excel.includes(day.slice(8, 10)));
    } else {
      ok = String(excel || '').trim() === String(mongo).trim();
    }
    if (!ok) missing.push({ field: f, column: col, mongo, excel });
  }

  const lastOut = await AlfaExcelOutboundUpdate.findOne({ caseId: c._id })
    .sort({ updatedAt: -1 })
    .select('status createdAt updatedAt changes lastError')
    .lean();

  if (missing.length) {
    gaps.push({
      consecutivo: c.consecutivo,
      id: String(c._id),
      excelRow: hit.rowNumber,
      strategy: hit.strategy,
      missing,
      lastOutbox: lastOut
        ? {
            status: lastOut.status,
            createdAt: lastOut.createdAt,
            fields: Object.keys(lastOut.changes || {}),
            lastError: lastOut.lastError,
          }
        : null,
      sync: c.controlSeguimientoExcel || null,
    });
  }
}

console.log('GAPS Mongo→Excel (amarillos con valor en ARNALD distintos/vacíos en Excel):', gaps.length);
console.log(JSON.stringify(gaps, null, 2));

// casos DOCUMENTACIÓN con fecha inspección
const docs = cases.filter(
  (c) =>
    String(c.estado || '').toUpperCase().includes('DOCUMENT') ||
    c.fechaInspeccion
);
console.log(
  '\nCasos con fechaInspeccion o DOCUMENTACIÓN:',
  docs.map((c) => ({
    consecutivo: c.consecutivo,
    estado: c.estado,
    fechaInspeccion: c.fechaInspeccion,
    valorReclamado: c.valorReclamado,
    valorLiquidado: c.valorLiquidado,
    sync: c.controlSeguimientoExcel?.status,
  }))
);

await mongoose.disconnect();
