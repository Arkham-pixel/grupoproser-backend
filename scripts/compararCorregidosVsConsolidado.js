/**
 * Compara el Excel de casos corregidos (el que se entregó al usuario)
 * vs la base CONSOLIDADO SharePoint.
 *
 * node scripts/compararCorregidosVsConsolidado.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import { downloadDriveItemBuffer } from '../services/microsoftGraphService.js';
import { findExcelRowForCase } from '../services/alfaExcelOutboundService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CORREGIDOS_PATH =
  process.argv[2] ||
  path.join(process.env.USERPROFILE || '', 'Desktop', 'alfa-casos-corregidos-2026-09-28.xlsx');

const CAMPOS = [
  ['valorReclamado', 'VALOR RECLAMADO'],
  ['valorLiquidado', 'VALOR LIQUIDADO'],
  ['liquidadoCoberturaTerremo', 'LIQUIDADO COBERTURA TERREMOTO'],
  ['deducibleTerremoto', 'DEDUCIBLE TERREMOTO'],
  ['valorLiquidacionCoberturasAdicionales', 'VALOR LIQUIDACIÓN COBERTURAS ADICIONALES'],
  ['deducibleCoberturasAdicionales', 'DEDUCIBLE COBERTURAS ADICIONALES'],
  ['valorTotalPagar', 'VALOR TOTAL A PAGAR'],
  ['reserva', 'RESERVA'],
];

function n(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const s = String(v).replace(/[^\d.,-]/g, '');
  if (!s) return null;
  let x = s;
  if (x.includes(',') && x.includes('.')) x = x.replace(/\./g, '').replace(',', '.');
  else if ((x.match(/\./g) || []).length > 1) x = x.replace(/\./g, '');
  const num = Number(x);
  return Number.isFinite(num) ? Math.round(num) : null;
}

function moneyEq(a, b) {
  const za = n(a) == null ? 0 : n(a);
  const zb = n(b) == null ? 0 : n(b);
  return za === zb;
}

function cellOf(row, headerMap, label) {
  const col = headerMap.get(normHeader(label));
  if (!col) return null;
  const cell = row.getCell(col);
  return cell?.value ?? null;
}

function normHeader(h) {
  return String(h ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

if (!fs.existsSync(CORREGIDOS_PATH)) {
  console.error('No existe Excel corregidos:', CORREGIDOS_PATH);
  process.exit(1);
}

const wbCorr = new ExcelJS.Workbook();
await wbCorr.xlsx.readFile(CORREGIDOS_PATH);
const wsCorr =
  wbCorr.getWorksheet('Casos corregidos') ||
  wbCorr.worksheets.find((w) => /correg/i.test(w.name)) ||
  wbCorr.worksheets[0];

const headerMap = new Map();
const headerRow = wsCorr.getRow(1);
headerRow.eachCell((cell, col) => {
  const key = normHeader(cell.text || cell.value);
  if (key) headerMap.set(key, col);
});

const corregidos = [];
for (let r = 2; r <= wsCorr.rowCount; r += 1) {
  const row = wsCorr.getRow(r);
  const consecutivo = String(cellOf(row, headerMap, 'CONSECUTIVO') || '').trim();
  if (!consecutivo) continue;
  const item = {
    consecutivo,
    identificacion: String(cellOf(row, headerMap, 'IDENTIFICACIÓN') || cellOf(row, headerMap, 'IDENTIFICACION') || '').trim(),
    asegurado: String(cellOf(row, headerMap, 'ASEGURADO') || '').trim(),
    motivo: String(cellOf(row, headerMap, 'MOTIVO CORRECCIÓN') || cellOf(row, headerMap, 'MOTIVO CORRECCION') || '').trim(),
  };
  for (const [campo, label] of CAMPOS) {
    item[campo] = n(cellOf(row, headerMap, label));
  }
  corregidos.push(item);
}

console.log('Corregidos leídos:', corregidos.length, 'de', CORREGIDOS_PATH);

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
if (!src?.itemId || isAlfaExcelFinalProtectedName(src.fileName)) {
  console.error('ABORT consolidado', src?.fileName);
  process.exit(1);
}

console.log('Descargando consolidado…', src.fileName);
const downloaded = await downloadDriveItemBuffer({
  driveId: src.driveId,
  itemId: src.itemId,
});
const parsed = parseAlfaExcelBuffer(downloaded.buffer || downloaded);
const excelRows = parsed.rows || [];
console.log('Filas consolidado:', excelRows.length);

const consecutivos = corregidos.map((c) => c.consecutivo);
const casos = await SegurosAlfaCaso.find({ consecutivo: { $in: consecutivos } })
  .select(
    [
      'consecutivo',
      'identificacion',
      'asegurado',
      'numeroPoliza',
      'numeroCredito',
      'direccionPredio',
      ...CAMPOS.map(([c]) => c),
    ].join(' ')
  )
  .lean();
const byCons = new Map(casos.map((c) => [c.consecutivo, c]));

const filas = [];
let ok = 0;
let diff = 0;
let sinFila = 0;
let noMongo = 0;

for (const corr of corregidos) {
  const caso = byCons.get(corr.consecutivo);
  if (!caso) {
    noMongo += 1;
    filas.push({
      consecutivo: corr.consecutivo,
      identificacion: corr.identificacion,
      asegurado: corr.asegurado,
      motivo: corr.motivo,
      veredicto: 'NO_EN_MONGO',
      excelRow: null,
      diffs: {},
    });
    continue;
  }

  let hit = null;
  let err = null;
  try {
    hit = findExcelRowForCase(caso, excelRows);
  } catch (e) {
    err = e.code || e.message;
  }

  if (!hit) {
    sinFila += 1;
    filas.push({
      consecutivo: corr.consecutivo,
      identificacion: corr.identificacion || caso.identificacion,
      asegurado: corr.asegurado || caso.asegurado,
      motivo: corr.motivo,
      veredicto: err || 'SIN_FILA_CONSOLIDADO',
      excelRow: null,
      corregidos: Object.fromEntries(CAMPOS.map(([c]) => [c, corr[c]])),
      consolidado: null,
      diffs: {},
    });
    continue;
  }

  const diffs = {};
  const consolidado = {};
  const corregidosVals = {};
  for (const [campo] of CAMPOS) {
    const a = corr[campo];
    const b = n(hit.payload?.[campo]);
    corregidosVals[campo] = a;
    consolidado[campo] = b;
    if (!moneyEq(a, b)) {
      diffs[campo] = { corregidos: a, consolidado: b };
    }
  }

  const veredicto = Object.keys(diffs).length ? 'DIFF' : 'OK';
  if (veredicto === 'OK') ok += 1;
  else diff += 1;

  filas.push({
    consecutivo: corr.consecutivo,
    identificacion: corr.identificacion || caso.identificacion,
    asegurado: corr.asegurado || caso.asegurado,
    motivo: corr.motivo,
    veredicto,
    excelRow: hit.rowNumber,
    strategy: hit.strategy,
    corregidos: corregidosVals,
    consolidado,
    diffs,
  });
}

const resumen = {
  fileCorregidos: CORREGIDOS_PATH,
  fileConsolidado: src.fileName,
  totalCorregidos: corregidos.length,
  ok,
  diff,
  sinFila,
  noMongo,
  pctOk: corregidos.length ? Math.round((ok / corregidos.length) * 1000) / 10 : 0,
};

// Excel de resultado
const outWb = new ExcelJS.Workbook();
const ws = outWb.addWorksheet('Comparación', { views: [{ state: 'frozen', ySplit: 1 }] });
const headers = [
  'CONSECUTIVO',
  'IDENTIFICACIÓN',
  'ASEGURADO',
  'MOTIVO',
  'VEREDICTO',
  'FILA CONSOLIDADO',
  'CAMPO',
  'EXCEL CORREGIDOS',
  'BASE CONSOLIDADO',
];
ws.addRow(headers);
ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };

for (const f of filas) {
  if (f.veredicto === 'OK') {
    ws.addRow([
      f.consecutivo,
      f.identificacion,
      f.asegurado,
      f.motivo,
      'OK',
      f.excelRow,
      '—',
      '',
      '',
    ]);
    continue;
  }
  if (!f.diffs || !Object.keys(f.diffs).length) {
    ws.addRow([
      f.consecutivo,
      f.identificacion,
      f.asegurado,
      f.motivo,
      f.veredicto,
      f.excelRow || '',
      '',
      '',
      '',
    ]);
    continue;
  }
  for (const [campo, d] of Object.entries(f.diffs)) {
    const label = CAMPOS.find(([c]) => c === campo)?.[1] || campo;
    const row = ws.addRow([
      f.consecutivo,
      f.identificacion,
      f.asegurado,
      f.motivo,
      'DIFF',
      f.excelRow,
      label,
      d.corregidos,
      d.consolidado,
    ]);
    row.getCell(5).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFC7CE' },
    };
  }
}

ws.getColumn(8).numFmt = '"$"#,##0';
ws.getColumn(9).numFmt = '"$"#,##0';
ws.columns.forEach((col, i) => {
  col.width = [18, 14, 28, 40, 14, 12, 28, 16, 16][i] || 14;
});

const wsR = outWb.addWorksheet('Resumen');
wsR.addRow(['Comparación Excel corregidos vs base consolidado']);
wsR.getRow(1).font = { bold: true, size: 13 };
wsR.addRow(['Generado', new Date().toISOString()]);
wsR.addRow(['Excel corregidos', CORREGIDOS_PATH]);
wsR.addRow(['Base consolidado', src.fileName]);
wsR.addRow(['Total casos corregidos', resumen.totalCorregidos]);
wsR.addRow(['OK (iguales)', resumen.ok]);
wsR.addRow(['Con diferencia', resumen.diff]);
wsR.addRow(['Sin fila en consolidado', resumen.sinFila]);
wsR.addRow(['No en Mongo', resumen.noMongo]);
wsR.addRow(['% OK', `${resumen.pctOk}%`]);
wsR.getColumn(1).width = 28;
wsR.getColumn(2).width = 80;

const outDir = path.join(__dirname, '..', 'tmp');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const outPath = path.join(outDir, `comparacion-corregidos-vs-consolidado-${stamp}.xlsx`);
await outWb.xlsx.writeFile(outPath);

const desktop = path.join(
  process.env.USERPROFILE || '',
  'Desktop',
  `comparacion-corregidos-vs-consolidado-${stamp}.xlsx`
);
try {
  fs.copyFileSync(outPath, desktop);
} catch (err) {
  console.warn('No se pudo copiar a Desktop (archivo abierto?):', err.code || err.message);
}

console.log(
  JSON.stringify(
    {
      resumen,
      outPath,
      desktop,
      diffs: filas.filter((f) => f.veredicto === 'DIFF'),
      sinFila: filas.filter((f) => f.veredicto !== 'OK' && f.veredicto !== 'DIFF'),
      okSample: filas.filter((f) => f.veredicto === 'OK').slice(0, 5).map((f) => ({
        consecutivo: f.consecutivo,
        excelRow: f.excelRow,
      })),
    },
    null,
    2
  )
);

await mongoose.disconnect();
process.exit(resumen.diff + resumen.sinFila > 0 ? 2 : 0);
