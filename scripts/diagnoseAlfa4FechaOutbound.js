/**
 * Inspecciona ALFA-4 (Vicuna) outbound vs fila Excel 5.
 * node scripts/diagnoseAlfa4FechaOutbound.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import {
  listFolder,
  downloadDriveItemBuffer,
  resolveDriveContext,
  resetMicrosoftGraphClient,
} from '../services/microsoftGraphService.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import { runAlfaExcelOutboundWorkerCycle } from '../workers/alfaExcelOutboundWorker.js';
import { enqueueAlfaExcelOutboundFromCaseUpdate } from '../services/alfaExcelOutboundService.js';

resetMicrosoftGraphClient();
await mongoose.connect(process.env.MONGO_URI);

const caso = await SegurosAlfaCaso.findOne({ consecutivo: 'ALFA-2026-08-4' }).lean();
const outs = await AlfaExcelOutboundUpdate.find({ caseId: caso._id })
  .sort({ updatedAt: -1 })
  .lean();

const cfg = getAlfaExcelSharePointImportConfig();
const listed = await listFolder(cfg.rootPath, { top: 50 });
const file = (listed.children || []).find((c) => c.name === cfg.fileName);
const { driveId } = await resolveDriveContext();
const { buffer } = await downloadDriveItemBuffer({ driveId, itemId: file.id });
const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
const sheet = wb.Sheets[wb.SheetNames[0]];
const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
const header = aoa[0];
const row5 = aoa[4]; // 0-index: row index 4 = excel row 5

console.log(
  JSON.stringify(
    {
      caso: {
        consecutivo: caso.consecutivo,
        id: caso.identificacion,
        fechaInspeccion: caso.fechaInspeccion,
        poliza: caso.numeroPoliza,
      },
      outbound: outs.map((o) => ({
        id: String(o._id),
        status: o.status,
        excelRowNumber: o.excelRowNumber,
        changes: o.changes,
        lastError: o.lastError,
        updatedAt: o.updatedAt,
        attempts: o.attempts,
      })),
      excelHeaderW: header[22],
      excelRow5: {
        id: row5?.[1],
        asegurado: row5?.[2],
        poliza: row5?.[4],
        fechaInspeccionColW: row5?.[22],
      },
    },
    null,
    2
  )
);

// Re-encolar fecha inspeccion forzando cambio
const before = { ...caso, fechaInspeccion: null };
const after = caso;
const enq = await enqueueAlfaExcelOutboundFromCaseUpdate({ beforeDoc: before, afterDoc: after });
console.log('enqueued', enq?._id ? String(enq._id) : null, enq?.status);

const cycle = await runAlfaExcelOutboundWorkerCycle({ batchSize: 5 });
console.log('cycle', JSON.stringify(cycle));

const outs2 = await AlfaExcelOutboundUpdate.find({ caseId: caso._id }).sort({ updatedAt: -1 }).limit(3).lean();
console.log(
  'afterRetry',
  JSON.stringify(
    outs2.map((o) => ({
      status: o.status,
      row: o.excelRowNumber,
      err: o.lastError,
      fecha: o.changes?.fechaInspeccion,
      updatedAt: o.updatedAt,
    })),
    null,
    2
  )
);

await mongoose.disconnect();
