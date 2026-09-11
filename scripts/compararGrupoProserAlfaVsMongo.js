/**
 * Comparativo SOLO LECTURA: Excel Alfa vs Mongo (operativo + respaldo).
 * No crea ni actualiza nada.
 *
 *   node scripts/compararGrupoProserAlfaVsMongo.js
 *   node scripts/compararGrupoProserAlfaVsMongo.js "C:/Users/GP-TI/Documents/Grupo Proser.xlsx"
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import dns from 'dns';
if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') dns.setServers(['8.8.8.8', '1.1.1.1']);
import XLSX from 'xlsx';
import mongoose from 'mongoose';
import {
  parseAlfaExcelBuffer,
  matchAlfaCaseForExcelRow,
} from '../services/alfaExcelImportService.js';
import { listAlfaCasosParaMatchExcel } from '../services/alfaCasosRespaldoService.js';
import { normalizeIdentification as normId } from '../utils/alfaIdentification.js';

const EXCEL = path.resolve(
  process.argv[2] || 'C:/Users/GP-TI/Documents/Grupo Proser.xlsx'
);
const OUT = path.resolve(
  process.env.COMPARATIVO_OUT ||
    path.join(process.env.USERPROFILE || '.', 'Documents', 'comparativo-grupo-proser-alfa.json')
);

/** Algunos xlsx de Alfa traen !ref hasta la fila ~1M (vacías) y sheet_to_json se cuelga. */
function readExcelBufferClamped(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true, cellNF: false, cellText: false });
  for (const name of wb.SheetNames || []) {
    const s = wb.Sheets[name];
    if (!s) continue;
    let maxR = 1;
    let maxC = 1;
    for (const k of Object.keys(s)) {
      if (k[0] === '!') continue;
      const addr = XLSX.utils.decode_cell(k);
      if (addr.r + 1 > maxR) maxR = addr.r + 1;
      if (addr.c + 1 > maxC) maxC = addr.c + 1;
    }
    s['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(0, maxR - 1), c: Math.max(0, maxC - 1) },
    });
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 30000,
});

if (!fs.existsSync(EXCEL)) {
  console.error(JSON.stringify({ ok: false, error: 'Excel no encontrado', EXCEL }));
  process.exit(1);
}

console.log(JSON.stringify({ event: 'READING', file: EXCEL }));
const buf = readExcelBufferClamped(EXCEL);
const parsed = parseAlfaExcelBuffer(buf);
const rows = parsed.rows || [];
console.log(
  JSON.stringify({
    event: 'PARSED',
    sheetName: parsed.sheetName,
    rows: rows.length,
    mappingFields: Object.keys(parsed.mapping || {}),
  })
);

const pool = await listAlfaCasosParaMatchExcel();
const activos = pool.filter((c) => c.excluidoBaseAlfa !== true);
const excluidos = pool.filter((c) => c.excluidoBaseAlfa === true);

const byAction = {
  MATCH_ACTIVO: [],
  MATCH_EXCLUIDO_RESTAURAR: [],
  CREATE: [],
  CREATE_INSEGURO: [],
  AMBIGUOUS: [],
  SKIP_SIN_ID: [],
};

function canCreate(payload = {}) {
  const id = normId(payload.identificacion);
  if (!id || String(id).length < 5) return false;
  const pol = String(payload.numeroPoliza || '').trim();
  const cred = String(payload.numeroCredito || '').trim();
  const sin = String(payload.siniestro || '').trim();
  const aseg = String(payload.asegurado || '').trim();
  return Boolean(pol || cred || sin || aseg);
}

for (const row of rows) {
  const payload = row.payload || {};
  const id = normId(payload.identificacion);
  if (!id) {
    byAction.SKIP_SIN_ID.push({
      excelRow: row.rowNumber,
      asegurado: payload.asegurado || null,
    });
    continue;
  }

  const matchActivo = matchAlfaCaseForExcelRow(payload, activos);
  if (matchActivo.actionHint === 'MATCH' && matchActivo.cases?.length === 1) {
    const c = matchActivo.cases[0];
    byAction.MATCH_ACTIVO.push({
      excelRow: row.rowNumber,
      identificacion: payload.identificacion,
      asegurado: payload.asegurado,
      numeroPoliza: payload.numeroPoliza,
      excelEstado: payload.estado || null,
      strategy: matchActivo.matchStrategy || matchActivo.strategy,
      consecutivo: c.consecutivo,
      mongoEstado: c.estado,
      mongoId: String(c._id),
    });
    continue;
  }
  if (matchActivo.actionHint === 'AMBIGUOUS') {
    byAction.AMBIGUOUS.push({
      excelRow: row.rowNumber,
      identificacion: payload.identificacion,
      asegurado: payload.asegurado,
      numeroPoliza: payload.numeroPoliza,
      strategy: matchActivo.matchStrategy,
      candidatos: (matchActivo.cases || []).map((c) => ({
        consecutivo: c.consecutivo,
        identificacion: c.identificacion,
        asegurado: c.asegurado,
        estado: c.estado,
        excluido: c.excluidoBaseAlfa === true,
      })),
    });
    continue;
  }

  const matchExcl = matchAlfaCaseForExcelRow(payload, excluidos);
  if (matchExcl.actionHint === 'MATCH' && matchExcl.cases?.length === 1) {
    const c = matchExcl.cases[0];
    byAction.MATCH_EXCLUIDO_RESTAURAR.push({
      excelRow: row.rowNumber,
      identificacion: payload.identificacion,
      asegurado: payload.asegurado,
      numeroPoliza: payload.numeroPoliza,
      strategy: matchExcl.matchStrategy || matchExcl.strategy,
      consecutivo: c.consecutivo,
      mongoEstado: c.estado,
      reason: c.excluidoBaseAlfaReason || null,
      mongoId: String(c._id),
    });
    continue;
  }
  if (matchExcl.actionHint === 'AMBIGUOUS') {
    byAction.AMBIGUOUS.push({
      excelRow: row.rowNumber,
      identificacion: payload.identificacion,
      asegurado: payload.asegurado,
      numeroPoliza: payload.numeroPoliza,
      strategy: matchExcl.matchStrategy,
      note: 'ambigüedad en excluidos/respaldo',
      candidatos: (matchExcl.cases || []).map((c) => ({
        consecutivo: c.consecutivo,
        identificacion: c.identificacion,
        asegurado: c.asegurado,
        estado: c.estado,
        excluido: true,
      })),
    });
    continue;
  }

  const item = {
    excelRow: row.rowNumber,
    identificacion: payload.identificacion,
    asegurado: payload.asegurado,
    tomador: payload.tomador || null,
    numeroPoliza: payload.numeroPoliza || null,
    numeroCredito: payload.numeroCredito || null,
    siniestro: payload.siniestro || null,
    ciudad: payload.ciudad || null,
    direccionPredio: payload.direccionPredio || null,
    excelEstado: payload.estado || null,
  };
  if (canCreate(payload)) byAction.CREATE.push(item);
  else byAction.CREATE_INSEGURO.push(item);
}

const summary = {
  file: EXCEL,
  excelRowsParsed: rows.length,
  mappingFields: Object.keys(parsed.mapping || {}),
  mongoPool: pool.length,
  mongoActivos: activos.length,
  mongoExcluidos: excluidos.length,
  counts: {
    yaExisten: byAction.MATCH_ACTIVO.length,
    restaurarExcluidos: byAction.MATCH_EXCLUIDO_RESTAURAR.length,
    nuevosCandidatos: byAction.CREATE.length,
    createInseguro: byAction.CREATE_INSEGURO.length,
    ambiguos: byAction.AMBIGUOUS.length,
    sinIdentificacion: byAction.SKIP_SIN_ID.length,
  },
};

const report = {
  event: 'COMPARATIVO_DRY_RUN',
  apply: false,
  summary,
  nuevosSample: byAction.CREATE.slice(0, 40),
  restaurarSample: byAction.MATCH_EXCLUIDO_RESTAURAR.slice(0, 20),
  ambiguosSample: byAction.AMBIGUOUS.slice(0, 20),
  createInseguroSample: byAction.CREATE_INSEGURO.slice(0, 10),
  nuevos: byAction.CREATE,
  restaurar: byAction.MATCH_EXCLUIDO_RESTAURAR,
  ambiguos: byAction.AMBIGUOUS,
  createInseguro: byAction.CREATE_INSEGURO,
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');

console.log(
  JSON.stringify(
    {
      event: 'COMPARATIVO_RESUMEN',
      apply: false,
      out: OUT,
      ...summary,
      hint: 'Revisar JSON/CSV. Nada se subió. Cuando aprueben, pedimos aplicar solo CREATE (+ restaurar si aplica).',
    },
    null,
    2
  )
);

const csvPath = OUT.replace(/\.json$/i, '-nuevos.csv');
const csvLines = [
  'excelRow;identificacion;asegurado;numeroPoliza;ciudad;excelEstado',
  ...byAction.CREATE.map(
    (r) =>
      `${r.excelRow};${r.identificacion};"${String(r.asegurado || '').replace(/"/g, '""')}";${r.numeroPoliza || ''};${r.ciudad || ''};${r.excelEstado || ''}`
  ),
];
fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf8');
console.log(JSON.stringify({ event: 'CSV_NUEVOS', path: csvPath, n: byAction.CREATE.length }));

await mongoose.disconnect();
