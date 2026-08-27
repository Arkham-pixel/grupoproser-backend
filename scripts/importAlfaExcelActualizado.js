/**
 * Importa Excel consolidado Alfa actualizado.
 * - Respeta datos ya en ARNALD (merge: no pisa con vacíos/placeholders).
 * - Duplicado válido solo si la póliza es distinta (CREATE_OTRA_POLIZA).
 *
 * Uso:
 *   node scripts/importAlfaExcelActualizado.js
 *   EXCEL_PATH="C:/ruta/archivo.xlsx" node scripts/importAlfaExcelActualizado.js
 *   DRY_RUN=true node scripts/importAlfaExcelActualizado.js   # solo preview
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  previewAlfaExcelImport,
  executeAlfaExcelImport,
} from '../services/alfaExcelImportService.js';
import { releaseAlfaExcelImportLock } from '../services/alfaExcelImportLockService.js';

const EXCEL_PATH = path.resolve(
  process.env.EXCEL_PATH ||
    'C:/Users/GP-TI/Downloads/Proser 2026 nuevo 26-08..xlsx'
);
const DRY = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';
const ALLOW_AMBIGUOUS =
  String(process.env.ALLOW_AMBIGUOUS || 'false').toLowerCase() === 'true';

if (!fs.existsSync(EXCEL_PATH)) {
  console.error('NO_EXISTE', EXCEL_PATH);
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 30000,
});

const before = await SegurosAlfaCaso.countDocuments();
console.log(
  JSON.stringify(
    {
      step: 'start',
      before,
      file: EXCEL_PATH,
      size: fs.statSync(EXCEL_PATH).size,
      dryRun: DRY,
    },
    null,
    2
  )
);

const buffer = fs.readFileSync(EXCEL_PATH);
const preview = await previewAlfaExcelImport({
  buffer,
  fileName: path.basename(EXCEL_PATH),
  user: { login: 'import-alfa-actualizado', rol: 'admin' },
});

const summary = {
  step: 'preview',
  importSessionId: preview.importSessionId,
  created: preview.created,
  updated: preview.updated,
  unchanged: preview.unchanged,
  rejected: preview.rejected,
  ambiguous: preview.ambiguous,
  insights: preview.insights,
};
console.log(JSON.stringify(summary, null, 2));

if ((preview.ambiguous || 0) > 0 && !ALLOW_AMBIGUOUS) {
  console.error('ABORT: hay filas ambiguous. Revise o use ALLOW_AMBIGUOUS=true');
  await mongoose.disconnect();
  process.exit(1);
}

if ((preview.rejected || 0) > 50) {
  console.warn('WARN: muchas rejected — se continúa con el resto');
}

if (DRY) {
  console.log('DRY_RUN: no se ejecutó el import');
  await mongoose.disconnect();
  process.exit(0);
}

try {
  await releaseAlfaExcelImportLock({ importId: String(preview.importSessionId) });
} catch {
  /* ok */
}

const executed = await executeAlfaExcelImport({
  importSessionId: String(preview.importSessionId),
  force: true,
  user: { login: 'import-alfa-actualizado', rol: 'admin' },
});

const after = await SegurosAlfaCaso.countDocuments();
console.log(
  JSON.stringify(
    {
      step: 'execute',
      totals: executed?.totals || executed,
      before,
      after,
      delta: after - before,
    },
    null,
    2
  )
);

await mongoose.disconnect();
