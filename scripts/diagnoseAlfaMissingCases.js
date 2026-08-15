/**
 * Localiza las filas Excel que no tienen caso ARNALD 1:1 (faltantes / ambiguas).
 * node scripts/diagnoseAlfaMissingCases.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {
  runAlfaExcelSharePointDetectCycle,
} from '../services/alfaExcelSharePointImportService.js';
import AlfaExcelImportRow from '../models/AlfaExcelImportRow.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { resetMicrosoftGraphClient } from '../services/microsoftGraphService.js';

resetMicrosoftGraphClient();
await mongoose.connect(process.env.MONGO_URI);

const before = await SegurosAlfaCaso.countDocuments();
const cycle = await runAlfaExcelSharePointDetectCycle({ force: true });
const sid = cycle.importSessionId;
const rows = await AlfaExcelImportRow.find({ importId: sid })
  .select('rowNumber action matchStrategy warnings payload.identificacion payload.asegurado payload.numeroPoliza payload.direccionPredio payload.siniestro matchedCaseIds')
  .lean();

const byAction = {};
for (const r of rows) byAction[r.action] = (byAction[r.action] || 0) + 1;

const interesting = rows.filter((r) =>
  ['CREATED', 'AMBIGUOUS', 'REJECTED'].includes(r.action)
);

console.log(
  JSON.stringify(
    {
      casosArnald: before,
      totalRows: rows.length,
      byAction,
      summary: cycle.summary,
      interesting: interesting.map((r) => ({
        row: r.rowNumber,
        action: r.action,
        id: r.payload?.identificacion,
        asegurado: String(r.payload?.asegurado || '').slice(0, 50),
        poliza: r.payload?.numeroPoliza,
        siniestro: r.payload?.siniestro,
        dir: String(r.payload?.direccionPredio || '').slice(0, 40),
        strategy: r.matchStrategy,
        warnings: r.warnings,
        matched: r.matchedCaseIds,
      })),
    },
    null,
    2
  )
);

await mongoose.disconnect();
