import 'dotenv/config';
import mongoose from 'mongoose';
import AlfaExcelImportLock from '../services/alfaExcelImportLockService.js';
import { executeAlfaExcelImport } from '../services/alfaExcelImportService.js';
import { markAlfaExcelSharePointExecuted } from '../services/alfaExcelSharePointImportService.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelImport from '../models/AlfaExcelImport.js';

await mongoose.connect(process.env.MONGO_URI);

const lock = await AlfaExcelImportLock.findById('alfa_excel_import').lean();
console.log('lock_before', JSON.stringify(lock));

await AlfaExcelImportLock.updateOne(
  { _id: 'alfa_excel_import' },
  {
    $set: {
      locked: false,
      lockedAt: null,
      lockedByImportId: null,
      lockedByLogin: null,
      expiresAt: null,
    },
  }
);

// Si la sesión quedó en processing, volver a preview
const sid = '6a7ff3fa5c8d2a00d40da88e';
const session = await AlfaExcelImport.findById(sid);
if (session && session.status === 'processing') {
  session.status = 'preview';
  await session.save();
  console.log('session_reset_to_preview');
}

const before = await SegurosAlfaCaso.countDocuments();
const executed = await executeAlfaExcelImport({
  importSessionId: sid,
  force: true,
  user: { login: 'sync-script', rol: 'admin' },
});
await markAlfaExcelSharePointExecuted({ importSessionId: sid });
const after = await SegurosAlfaCaso.countDocuments();
console.log(JSON.stringify({ before, after, totals: executed.totals }, null, 2));
await mongoose.disconnect();
