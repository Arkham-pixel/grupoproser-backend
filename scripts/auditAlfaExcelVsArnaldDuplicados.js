/**
 * Diagnóstico: conteo Excel vs ARNALD + duplicados (sobre todo al final).
 * node scripts/auditAlfaExcelVsArnaldDuplicados.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import { downloadDriveItemBuffer } from '../services/microsoftGraphService.js';
import { findExcelRowForCase } from '../services/alfaExcelOutboundService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

function normId(v) {
  return String(v ?? '')
    .replace(/\D/g, '')
    .replace(/^0+/, '') || String(v ?? '').trim();
}

function normDir(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 80);
}

function normPol(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function pick(p = {}) {
  return {
    id: p.identificacion,
    asegurado: p.asegurado,
    poliza: p.numeroPoliza,
    credito: p.numeroCredito,
    dir: (p.direccionPredio || '').slice(0, 60),
    estado: p.estado,
    reclamado: p.valorReclamado,
    liquidado: p.valorLiquidado,
  };
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
});

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
if (!src?.itemId) {
  console.error('No Excel source');
  process.exit(1);
}

console.log('Excel file:', src.fileName, 'protectedFinal?', isAlfaExcelFinalProtectedName(src.fileName));

const downloaded = await downloadDriveItemBuffer({
  driveId: src.driveId,
  itemId: src.itemId,
});
const parsed = parseAlfaExcelBuffer(downloaded.buffer || downloaded);
const excelRows = parsed.rows || [];

const mongoAll = await SegurosAlfaCaso.find({}).select(
  'consecutivo identificacion asegurado numeroPoliza numeroCredito direccionPredio excluidoBaseAlfa estado valorReclamado valorLiquidado updatedAt'
).lean();
const mongoActivos = mongoAll.filter((c) => c.excluidoBaseAlfa !== true);
const mongoExcluidos = mongoAll.filter((c) => c.excluidoBaseAlfa === true);

console.log(
  JSON.stringify(
    {
      excelRows: excelRows.length,
      mongoTotal: mongoAll.length,
      mongoActivos: mongoActivos.length,
      mongoExcluidos: mongoExcluidos.length,
      deltaExcelMenosActivos: excelRows.length - mongoActivos.length,
    },
    null,
    2
  )
);

// Duplicados en Excel por ID+dir / ID+poliza / solo ID
const byId = new Map();
const byIdDir = new Map();
const byIdPol = new Map();
for (const r of excelRows) {
  const p = r.payload || {};
  const id = normId(p.identificacion);
  if (!id || id.length < 5) continue;
  const keyDir = `${id}|${normDir(p.direccionPredio)}`;
  const keyPol = `${id}|${normPol(p.numeroPoliza)}`;
  if (!byId.has(id)) byId.set(id, []);
  byId.get(id).push(r);
  if (!byIdDir.has(keyDir)) byIdDir.set(keyDir, []);
  byIdDir.get(keyDir).push(r);
  if (!byIdPol.has(keyPol)) byIdPol.set(keyPol, []);
  byIdPol.get(keyPol).push(r);
}

const dupsId = [...byId.entries()].filter(([, arr]) => arr.length > 1);
const dupsIdDir = [...byIdDir.entries()].filter(([, arr]) => arr.length > 1);
const dupsIdPol = [...byIdPol.entries()].filter(([, arr]) => arr.length > 1);

console.log('\n=== Dups Excel misma ID ===', dupsId.length);
console.log('=== Dups Excel misma ID+dirección ===', dupsIdDir.length);
console.log('=== Dups Excel misma ID+póliza ===', dupsIdPol.length);

// Mostrar dups ID+dir (verdaderos duplicados de fila)
const verdaderos = dupsIdDir
  .map(([k, arr]) => ({
    key: k,
    count: arr.length,
    rows: arr.map((r) => ({ rowNumber: r.rowNumber, ...pick(r.payload) })),
  }))
  .sort((a, b) => Math.max(...b.rows.map((x) => x.rowNumber)) - Math.max(...a.rows.map((x) => x.rowNumber)));

console.log('\n=== Verdaderos duplicados ID+dir (top 20, más abajo primero) ===');
for (const d of verdaderos.slice(0, 20)) {
  console.log(JSON.stringify(d));
}

// Últimas 15 filas Excel
console.log('\n=== Últimas 15 filas Excel ===');
const sorted = [...excelRows].sort((a, b) => a.rowNumber - b.rowNumber);
for (const r of sorted.slice(-15)) {
  console.log(JSON.stringify({ rowNumber: r.rowNumber, ...pick(r.payload) }));
}

// Filas Excel sin match en Mongo activos
let sinMatchMongo = 0;
const sinMatchSamples = [];
const mongoById = new Map();
for (const c of mongoActivos) {
  const id = normId(c.identificacion);
  if (!id) continue;
  if (!mongoById.has(id)) mongoById.set(id, []);
  mongoById.get(id).push(c);
}
for (const r of excelRows) {
  const id = normId(r.payload?.identificacion);
  if (!id || !mongoById.has(id)) {
    sinMatchMongo += 1;
    if (sinMatchSamples.length < 12) {
      sinMatchSamples.push({ rowNumber: r.rowNumber, ...pick(r.payload) });
    }
  }
}
console.log('\n=== Filas Excel sin ID en Mongo activos ===', sinMatchMongo);
console.log(JSON.stringify(sinMatchSamples, null, 2));

// Casos ARNALD que no encuentran fila (o ambigüedad)
let notFound = 0;
let ambiguous = 0;
let matched = 0;
const notFoundSamples = [];
const ambiguousSamples = [];
for (const caso of mongoActivos) {
  try {
    findExcelRowForCase(caso, excelRows);
    matched += 1;
  } catch (e) {
    if (e?.code === 'EXCEL_ROW_NOT_FOUND') {
      notFound += 1;
      if (notFoundSamples.length < 15) {
        notFoundSamples.push({
          consecutivo: caso.consecutivo,
          ...pick(caso),
        });
      }
    } else if (e?.code === 'AMBIGUOUS_EXCEL_ROW') {
      ambiguous += 1;
      if (ambiguousSamples.length < 15) {
        ambiguousSamples.push({
          consecutivo: caso.consecutivo,
          ...pick(caso),
          candidates: e.candidates || e.rows || null,
          message: e.message,
        });
      }
    } else {
      notFound += 1;
      if (notFoundSamples.length < 15) {
        notFoundSamples.push({
          consecutivo: caso.consecutivo,
          err: e.code || e.message,
          ...pick(caso),
        });
      }
    }
  }
}
console.log('\n=== Match ARNALD→Excel ===', { matched, notFound, ambiguous });
console.log('notFound samples:', JSON.stringify(notFoundSamples, null, 2));
console.log('ambiguous samples:', JSON.stringify(ambiguousSamples, null, 2));

// Extra: IDs con más filas Excel que casos Mongo
const extraRows = [];
for (const [id, rows] of byId.entries()) {
  const casos = mongoById.get(id) || [];
  if (rows.length > Math.max(casos.length, 1) && rows.length > casos.length) {
    extraRows.push({
      id,
      excel: rows.length,
      mongo: casos.length,
      rowNumbers: rows.map((r) => r.rowNumber).sort((a, b) => a - b),
      consecutivos: casos.map((c) => c.consecutivo),
      last: pick(rows.sort((a, b) => b.rowNumber - a.rowNumber)[0].payload),
    });
  }
}
extraRows.sort((a, b) => Math.max(...b.rowNumbers) - Math.max(...a.rowNumbers));
console.log('\n=== IDs con MÁS filas Excel que casos Mongo ===', extraRows.length);
for (const x of extraRows.slice(0, 25)) {
  console.log(JSON.stringify(x));
}

await mongoose.disconnect();
