/**
 * Valida matching + patch local columna X (sin upload).
 * Útil si SharePoint tiene el Excel bloqueado (423).
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import {
  downloadDriveItemBuffer,
  getItemMetadata,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import {
  findExcelRowForCase,
  patchYellowCellsInWorkbookBuffer,
} from '../services/alfaExcelOutboundService.js';

const CASE_ID = process.argv[2] || '6a7c96aa54984615b6dff255';

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const caseDoc = await SegurosAlfaCaso.findById(CASE_ID).lean();
  if (!caseDoc) throw new Error('CASE_NOT_FOUND');

  const source = await AlfaExcelSharePointSource.findOne({
    integrationKey: 'alfa-excel-control-seguimiento',
  });
  const ctx = await resolveDriveContext();
  const meta = await getItemMetadata(source.itemId);
  console.log('eTag', meta.eTag);

  const dl = await downloadDriveItemBuffer({
    driveId: source.driveId || ctx.driveId,
    itemId: source.itemId,
  });
  const parsed = parseAlfaExcelBuffer(dl.buffer);
  const hit = findExcelRowForCase(caseDoc, parsed.rows);
  console.log('MATCH', hit);

  const wb0 = new ExcelJS.Workbook();
  await wb0.xlsx.load(dl.buffer);
  const ws0 = wb0.getWorksheet(parsed.sheetName);
  const before = {};
  for (let c = 1; c <= 28; c += 1) {
    const v = ws0.getRow(hit.rowNumber).getCell(c).value;
    before[c] = v instanceof Date ? v.toISOString() : v == null ? null : String(v);
  }
  console.log('X before', before[24]);

  const patched = await patchYellowCellsInWorkbookBuffer({
    buffer: dl.buffer,
    sheetName: parsed.sheetName,
    excelRowNumber: hit.rowNumber,
    cellUpdates: [
      {
        field: 'fechaUltimoDocumento',
        column: 'X',
        value: '2026-08-14T12:00:00.000Z',
      },
    ],
  });

  const wb1 = new ExcelJS.Workbook();
  await wb1.xlsx.load(patched);
  const ws1 = wb1.getWorksheet(parsed.sheetName);
  const changed = [];
  for (let c = 1; c <= 28; c += 1) {
    const v = ws1.getRow(hit.rowNumber).getCell(c).value;
    const s = v instanceof Date ? v.toISOString() : v == null ? null : String(v);
    if (s !== before[c]) changed.push({ c, before: before[c], after: s });
  }
  console.log('changed', changed);
  if (!(changed.length === 1 && changed[0].c === 24)) {
    throw new Error('LOCAL_PATCH_NOT_ONLY_X');
  }
  console.log('LOCAL PATCH PASS (only column X)');

  await SegurosAlfaCaso.updateOne(
    { _id: CASE_ID },
    {
      $set: {
        fechaUltimoDocumento: new Date('2026-08-14T12:00:00.000Z'),
        'controlSeguimientoExcel.status': 'pending',
      },
    }
  );

  await AlfaExcelOutboundUpdate.findOneAndUpdate(
    { caseId: CASE_ID, status: { $in: ['failed', 'pending', 'processing'] } },
    {
      $set: {
        status: 'pending',
        attempts: 0,
        nextRetryAt: new Date(),
        lastError: null,
        lastErrorCode: null,
        changes: {
          fechaUltimoDocumento: {
            before: null,
            after: '2026-08-14T12:00:00.000Z',
            column: 'X',
            header: 'FECHA ULTIMO DOCUMENTO',
          },
        },
      },
    },
    { sort: { updatedAt: -1 } }
  );

  console.log('Outbox pending listo. Cierre el Excel en SharePoint y ejecute:');
  console.log('  node -e "import(\'./config/loadEnv.js\'); import mongoose from \'mongoose\'; import { runAlfaExcelOutboundWorkerCycle } from \'./workers/alfaExcelOutboundWorker.js\'; await mongoose.connect(process.env.MONGO_URI); console.log(await runAlfaExcelOutboundWorkerCycle()); await mongoose.disconnect();"');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
