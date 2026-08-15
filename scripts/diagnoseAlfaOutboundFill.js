/**
 * Diagnóstico outbound Excel Alfa (ARNALD → SharePoint).
 * node scripts/diagnoseAlfaOutboundFill.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { runAlfaExcelOutboundWorkerCycle } from '../workers/alfaExcelOutboundWorker.js';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';

await mongoose.connect(process.env.MONGO_URI);

const cfg = getAlfaExcelOutboundConfig();
const total = await SegurosAlfaCaso.countDocuments();

const conFechaInspeccion = await SegurosAlfaCaso.countDocuments({
  fechaInspeccion: { $exists: true, $ne: null, $ne: '' },
});

// $ne twice may not work in mongo - use $nin
const conFecha = await SegurosAlfaCaso.countDocuments({
  fechaInspeccion: { $exists: true, $nin: [null, ''] },
});

const byStatus = await AlfaExcelOutboundUpdate.aggregate([
  { $group: { _id: '$status', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);

const byField = await AlfaExcelOutboundUpdate.aggregate([
  { $group: { _id: { field: '$field', status: '$status' }, n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 40 },
]);

const fechaOut = await AlfaExcelOutboundUpdate.aggregate([
  { $match: { field: 'fechaInspeccion' } },
  { $group: { _id: '$status', n: { $sum: 1 } } },
]);

const pending = await AlfaExcelOutboundUpdate.countDocuments({
  status: { $in: ['pending', 'queued', 'processing', 'retry'] },
});

const recentFailed = await AlfaExcelOutboundUpdate.find({ status: 'failed' })
  .sort({ updatedAt: -1 })
  .limit(12)
  .select('field status lastError attempts excelRowNumber updatedAt')
  .lean();

const recentDone = await AlfaExcelOutboundUpdate.find({
  status: { $in: ['done', 'synced', 'applied', 'success'] },
})
  .sort({ updatedAt: -1 })
  .limit(12)
  .select('field status excelRowNumber updatedAt')
  .lean();

const sampleStatuses = await AlfaExcelOutboundUpdate.distinct('status');

console.log(
  JSON.stringify(
    {
      cfg: {
        enabled: cfg.enabled ?? cfg.cronEnabled,
        cron: cfg.cronSchedule || cfg.cron,
        batchSize: cfg.batchSize,
      },
      envOutbound: process.env.SHAREPOINT_ALFA_EXCEL_OUTBOUND_ENABLED,
      totalCasos: total,
      casosConFechaInspeccion: conFecha,
      outboundByStatus: byStatus,
      fechaInspeccionOutbound: fechaOut,
      pending,
      sampleStatuses,
      byFieldTop: byField,
      recentFailed,
      recentDone,
    },
    null,
    2
  )
);

await mongoose.disconnect();
