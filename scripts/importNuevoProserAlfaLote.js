/**
 * Importa el lote "Nuevo PROSER 03-09-2026":
 * - Crea casos nuevos
 * - Si ya existen, actualiza identidad (no toca consecutivo ni estado)
 * - Restaura desde respaldo si estaban archivados
 * - Append de esas cédulas al Excel de SharePoint
 *
 *   node scripts/importNuevoProserAlfaLote.js
 *   node scripts/importNuevoProserAlfaLote.js --apply
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import dns from 'dns';
if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import {
  createAlfaCasoFromImport,
  updateAlfaCasoFields,
  computeAlfaImportDiff,
} from '../services/alfaCasoService.js';
import {
  getAlfaRespaldoCollection,
  restoreAlfaCasoFromRespaldoById,
} from '../services/alfaCasosRespaldoService.js';
import { ALFA_EXCEL_UPDATABLE_FIELDS } from '../config/alfaExcelColumnMap.js';
import { syncMissingArnaldCasosToAlfaExcel } from '../services/alfaExcelOutboundService.js';
import { normalizeIdentification as normId } from '../utils/alfaIdentification.js';

const APPLY = process.argv.includes('--apply');
const EXCEL = path.resolve(
  process.argv.find((a) => a.endsWith('.xlsx')) ||
    'C:/Users/GP-TI/Downloads/Nuevo PROSER 03-09-2026 (1).xlsx'
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 25000,
});

const parsed = parseAlfaExcelBuffer(fs.readFileSync(EXCEL));
const rows = parsed.rows || [];
const ids = [...new Set(rows.map((r) => String(r.payload?.identificacion || '').trim()).filter(Boolean))];

const operativos = await SegurosAlfaCaso.find({ identificacion: { $in: ids } }).lean();
const respaldo = await getAlfaRespaldoCollection()
  .find({ identificacion: { $in: ids } })
  .toArray();

const plan = [];
for (const row of rows) {
  const payload = row.payload || {};
  const id = String(payload.identificacion || '').trim();
  const nid = normId(id);
  const op =
    operativos.find((c) => normId(c.identificacion) === nid) ||
    operativos.find((c) => String(c.identificacion) === id);
  const re =
    respaldo.find((c) => normId(c.identificacion) === nid) ||
    respaldo.find((c) => String(c.identificacion) === id);
  let action = 'CREATE';
  let target = null;
  if (op) {
    action = op.excluidoBaseAlfa === true ? 'UNEXCLUDE_UPDATE' : 'UPDATE';
    target = op;
  } else if (re) {
    action = 'RESTORE_UPDATE';
    target = re;
  }
  plan.push({
    identificacion: id,
    asegurado: payload.asegurado,
    action,
    consecutivo: target?.consecutivo || null,
  });
}

console.log(JSON.stringify({ event: 'PLAN', apply: APPLY, file: EXCEL, plan }, null, 2));
if (!APPLY) {
  console.log(JSON.stringify({ event: 'DRY_RUN', hint: 'Agregue --apply para ejecutar' }));
  await mongoose.disconnect();
  process.exit(0);
}

const results = [];
for (const row of rows) {
  const payload = { ...(row.payload || {}) };
  const id = String(payload.identificacion || '').trim();
  const nid = normId(id);
  let existing = await SegurosAlfaCaso.findOne({ identificacion: id }).lean();
  if (!existing) {
    const re = await getAlfaRespaldoCollection().findOne({
      $or: [{ identificacion: id }, { identificacion: nid }],
    });
    if (re) {
      existing = await restoreAlfaCasoFromRespaldoById(re._id, { unexclude: true });
    }
  }
  if (existing?.excluidoBaseAlfa === true) {
    await SegurosAlfaCaso.updateOne(
      { _id: existing._id },
      {
        $set: { excluidoBaseAlfa: false },
        $unset: { excluidoBaseAlfaAt: 1, excluidoBaseAlfaReason: 1 },
      }
    );
    existing = await SegurosAlfaCaso.findById(existing._id).lean();
  }

  if (existing) {
    const { patch, hasChanges } = computeAlfaImportDiff(
      payload,
      existing,
      ALFA_EXCEL_UPDATABLE_FIELDS
    );
    if (hasChanges && Object.keys(patch).length) {
      await updateAlfaCasoFields(existing._id, patch);
    }
    const after = await SegurosAlfaCaso.findById(existing._id)
      .select('consecutivo identificacion asegurado estado numeroPoliza excluidoBaseAlfa')
      .lean();
    results.push({ action: 'KEEP', hasChanges, ...after });
    continue;
  }

  const created = await createAlfaCasoFromImport({ ...payload, estado: 'Sin contactar' });
  results.push({
    action: 'CREATE',
    consecutivo: created.consecutivo,
    identificacion: created.identificacion,
    asegurado: created.asegurado,
    estado: created.estado,
  });
}

console.log(JSON.stringify({ event: 'MONGO', results }, null, 2));

let excel = null;
let lastErr = null;
for (let attempt = 1; attempt <= 6; attempt += 1) {
  try {
    excel = await syncMissingArnaldCasosToAlfaExcel({
      batchSize: ids.length,
      identificaciones: ids,
    });
    lastErr = null;
    break;
  } catch (e) {
    lastErr = e;
    console.warn(JSON.stringify({ attempt, code: e.code, error: e.message }));
    if (e.code !== 'EXCEL_SOURCE_LOCKED' && e.code !== 'EXCEL_SOURCE_ETAG_CHANGED') break;
    await sleep(20000);
  }
}

if (lastErr) {
  console.error(
    JSON.stringify({
      ok: false,
      mongo: true,
      excel: false,
      code: lastErr.code,
      error: lastErr.message,
    })
  );
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, excel }, null, 2));
}

await mongoose.disconnect();
