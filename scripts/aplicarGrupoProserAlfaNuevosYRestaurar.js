/**
 * Aplica solo:
 *  - CREATE de filas nuevas del Excel Grupo Proser
 *  - RESTORE de excluidos/respaldo que SÍ aparecen en ese Excel
 * No toca los 1977 ya existentes ni excluidos fuera del Excel.
 *
 *   node scripts/aplicarGrupoProserAlfaNuevosYRestaurar.js --apply
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import dns from 'dns';
if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') dns.setServers(['8.8.8.8', '1.1.1.1']);
import XLSX from 'xlsx';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  parseAlfaExcelBuffer,
  matchAlfaCaseForExcelRow,
} from '../services/alfaExcelImportService.js';
import {
  createAlfaCasoFromImport,
} from '../services/alfaCasoService.js';
import {
  listAlfaCasosParaMatchExcel,
  restoreAlfaCasoFromRespaldoById,
} from '../services/alfaCasosRespaldoService.js';
import { syncMissingArnaldCasosToAlfaExcel } from '../services/alfaExcelOutboundService.js';
import { normalizeIdentification as normId } from '../utils/alfaIdentification.js';
import { homologarEstadoAlfa } from '../config/alfaExcelStatuses.js';

const APPLY = process.argv.includes('--apply');
const EXCEL = path.resolve(
  process.argv.find((a) => a.endsWith('.xlsx') && !a.includes('--')) ||
    'C:/Users/GP-TI/Documents/Grupo Proser.xlsx'
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

const buf = readExcelBufferClamped(EXCEL);
const parsed = parseAlfaExcelBuffer(buf);
const rows = parsed.rows || [];
const pool = await listAlfaCasosParaMatchExcel();
const activos = pool.filter((c) => c.excluidoBaseAlfa !== true);
const excluidos = pool.filter((c) => c.excluidoBaseAlfa === true);

const planCreate = [];
const planRestore = [];
const seenRestore = new Set();
const seenCreate = new Set();

for (const row of rows) {
  const payload = row.payload || {};
  const id = normId(payload.identificacion);
  if (!id) continue;

  const matchActivo = matchAlfaCaseForExcelRow(payload, activos);
  if (matchActivo.actionHint === 'MATCH' || matchActivo.actionHint === 'AMBIGUOUS') continue;

  const matchExcl = matchAlfaCaseForExcelRow(payload, excluidos);
  if (matchExcl.actionHint === 'MATCH' && matchExcl.cases?.length === 1) {
    const c = matchExcl.cases[0];
    const key = String(c._id);
    if (!seenRestore.has(key)) {
      seenRestore.add(key);
      planRestore.push({
        excelRow: row.rowNumber,
        mongoId: key,
        consecutivo: c.consecutivo,
        identificacion: c.identificacion,
        asegurado: c.asegurado,
        payload,
      });
    }
    continue;
  }
  if (matchExcl.actionHint === 'AMBIGUOUS') continue;

  if (!seenCreate.has(id)) {
    seenCreate.add(id);
    planCreate.push({
      excelRow: row.rowNumber,
      identificacion: payload.identificacion,
      asegurado: payload.asegurado,
      payload,
    });
  }
}

console.log(
  JSON.stringify(
    {
      event: 'PLAN',
      apply: APPLY,
      file: EXCEL,
      create: planCreate.length,
      restore: planRestore.length,
      createSample: planCreate.slice(0, 5).map((p) => ({
        excelRow: p.excelRow,
        identificacion: p.identificacion,
        asegurado: p.asegurado,
      })),
      restoreSample: planRestore.slice(0, 5).map((p) => ({
        excelRow: p.excelRow,
        consecutivo: p.consecutivo,
        identificacion: p.identificacion,
        asegurado: p.asegurado,
      })),
    },
    null,
    2
  )
);

if (!APPLY) {
  console.log(JSON.stringify({ event: 'DRY_RUN', hint: 'Agregue --apply para ejecutar' }));
  await mongoose.disconnect();
  process.exit(0);
}

const results = { created: [], restored: [], errors: [] };
const idsForExcel = [];

for (const item of planRestore) {
  try {
    // Si el consecutivo ya lo usa otro caso operativo distinto, reasignar
    const ocupante = await SegurosAlfaCaso.findOne({
      consecutivo: item.consecutivo,
      _id: { $ne: item.mongoId },
      $or: [{ excluidoBaseAlfa: { $exists: false } }, { excluidoBaseAlfa: false }],
    }).lean();

    let consecutivo = item.consecutivo;
    if (ocupante) {
      const { generarConsecutivoAlfa } = await import('../services/alfaCasoService.js');
      consecutivo = await generarConsecutivoAlfa();
      const { getAlfaRespaldoCollection } = await import('../services/alfaCasosRespaldoService.js');
      await getAlfaRespaldoCollection().updateOne(
        { _id: new mongoose.Types.ObjectId(item.mongoId) },
        {
          $set: {
            consecutivo,
            consecutivoAnteriorAlRestaurar: item.consecutivo,
            consecutivoReasignadoAt: new Date(),
          },
        }
      );
    }

    const restored = await restoreAlfaCasoFromRespaldoById(item.mongoId, { unexclude: true });
    if (!restored) throw new Error('restore returned null');
    if (String(restored.consecutivo) !== String(consecutivo)) {
      await SegurosAlfaCaso.updateOne(
        { _id: restored._id },
        { $set: { consecutivo } }
      );
    }
    const after = await SegurosAlfaCaso.findById(item.mongoId)
      .select('consecutivo identificacion asegurado estado excluidoBaseAlfa')
      .lean();
    results.restored.push({
      ...after,
      reassigned: consecutivo !== item.consecutivo,
      consecutivoAnterior: item.consecutivo,
    });
    idsForExcel.push(String(after.identificacion));
  } catch (e) {
    results.errors.push({
      action: 'RESTORE',
      identificacion: item.identificacion,
      error: e.message,
    });
  }
}

for (const item of planCreate) {
  try {
    const exists = await SegurosAlfaCaso.findOne({
      identificacion: String(item.identificacion),
      $or: [{ excluidoBaseAlfa: { $exists: false } }, { excluidoBaseAlfa: false }],
    }).lean();
    if (exists) {
      results.errors.push({
        action: 'CREATE_SKIP_EXISTS',
        identificacion: item.identificacion,
        consecutivo: exists.consecutivo,
      });
      continue;
    }
    const created = await createAlfaCasoFromImport({
      ...item.payload,
      estado: 'Sin contactar',
      estadoGestion: 'Sin contactar',
    });
    // Forzar homologación amigable (createAlfaCasoFromImport puede mapear PENDIENTE)
    const estadoFinal = homologarEstadoAlfa('Sin contactar') || 'Sin contactar';
    await SegurosAlfaCaso.updateOne(
      { _id: created._id },
      { $set: { estado: estadoFinal, estadoGestion: 'Sin contactar' } }
    );
    const after = await SegurosAlfaCaso.findById(created._id)
      .select('consecutivo identificacion asegurado estado excluidoBaseAlfa')
      .lean();
    results.created.push(after);
    idsForExcel.push(String(after.identificacion));
  } catch (e) {
    results.errors.push({
      action: 'CREATE',
      identificacion: item.identificacion,
      error: e.message,
    });
  }
}

console.log(
  JSON.stringify(
    {
      event: 'MONGO_DONE',
      created: results.created.length,
      restored: results.restored.length,
      errors: results.errors.length,
      createdList: results.created,
      restoredList: results.restored,
      errorsList: results.errors,
    },
    null,
    2
  )
);

let excel = null;
let lastErr = null;
if (idsForExcel.length) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      excel = await syncMissingArnaldCasosToAlfaExcel({
        batchSize: Math.min(80, idsForExcel.length),
        identificaciones: idsForExcel,
      });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      console.warn(JSON.stringify({ attempt, code: e.code, error: e.message }));
      if (e.code !== 'EXCEL_SOURCE_LOCKED' && e.code !== 'EXCEL_SOURCE_ETAG_CHANGED') break;
      await sleep(15000);
    }
  }
}

console.log(
  JSON.stringify(
    {
      ok: !lastErr,
      mongo: { created: results.created.length, restored: results.restored.length },
      excel: lastErr
        ? { error: lastErr.message, code: lastErr.code }
        : { appended: excel?.appended, excelRowsAfter: excel?.excelRowsAfter, fileName: excel?.fileName },
    },
    null,
    2
  )
);

await mongoose.disconnect();
if (lastErr) process.exitCode = 1;
