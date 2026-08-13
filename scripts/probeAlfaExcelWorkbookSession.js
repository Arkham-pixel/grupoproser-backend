import '../config/loadEnv.js';
import mongoose from 'mongoose';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { resolveDriveContext, graphRequest } from '../services/microsoftGraphService.js';

await mongoose.connect(process.env.MONGO_URI);
const source = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
});
const ctx = await resolveDriveContext();
const driveId = source.driveId || ctx.driveId;
const itemId = source.itemId;
try {
  const session = await graphRequest(
    `/drives/${driveId}/items/${itemId}/workbook/createSession`,
    { method: 'POST', body: { persistChanges: true } }
  );
  console.log('SESSION_OK', session);
} catch (e) {
  console.log('SESSION_FAIL', e.status, e.code, e.message);
}
await mongoose.disconnect();
