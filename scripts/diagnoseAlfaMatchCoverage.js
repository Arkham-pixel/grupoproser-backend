import 'dotenv/config';
import mongoose from 'mongoose';
import AlfaExcelImportRow from '../models/AlfaExcelImportRow.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelImport from '../models/AlfaExcelImport.js';

await mongoose.connect(process.env.MONGO_URI);
const session = await AlfaExcelImport.findOne({ source: 'sharepoint' })
  .sort({ createdAt: -1 })
  .lean();
const sid = session?._id;
const rows = await AlfaExcelImportRow.find({ importId: sid })
  .select('rowNumber action matchedCaseId matchedCaseIds payload.identificacion')
  .lean();

const matchedIds = new Set();
for (const r of rows) {
  if (r.matchedCaseId) matchedIds.add(String(r.matchedCaseId));
  for (const id of r.matchedCaseIds || []) matchedIds.add(String(id));
}

const allCaseIds = (await SegurosAlfaCaso.find({}).select('_id').lean()).map((c) =>
  String(c._id)
);
const orphanCases = allCaseIds.filter((id) => !matchedIds.has(id));

const byAction = {};
const matchedUniqueByAction = {};
for (const r of rows) {
  byAction[r.action] = (byAction[r.action] || 0) + 1;
  if (r.matchedCaseId) {
    matchedUniqueByAction[r.action] = matchedUniqueByAction[r.action] || new Set();
    matchedUniqueByAction[r.action].add(String(r.matchedCaseId));
  }
}

console.log(
  JSON.stringify(
    {
      session: String(sid),
      totalRows: rows.length,
      byAction,
      matchedUnique: Object.fromEntries(
        Object.entries(matchedUniqueByAction).map(([k, v]) => [k, v.size])
      ),
      matchedIdsTotal: matchedIds.size,
      casosTotal: allCaseIds.length,
      orphanCount: orphanCases.length,
      gapExcelVsCasos: rows.length - allCaseIds.length,
    },
    null,
    2
  )
);
await mongoose.disconnect();
