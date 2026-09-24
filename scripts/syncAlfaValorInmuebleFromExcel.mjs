/**
 * Alinea valorAseguradoInmueble/SID del caso y del liquidador.encabezado
 * al valor saneado del Excel SharePoint. Lotes chicos, sin outbound.
 *
 * node scripts/syncAlfaValorInmuebleFromExcel.mjs --dry-run
 * node scripts/syncAlfaValorInmuebleFromExcel.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { downloadDriveItemBuffer } from '../services/microsoftGraphService.js';
import {
  parseAlfaExcelBuffer,
  matchAlfaCaseForExcelRow,
} from '../services/alfaExcelImportService.js';
import { listAlfaCasosParaMatchExcel } from '../services/alfaCasosRespaldoService.js';
import { normalizeMoneyOficial } from '../utils/alfaExcelNormalize.js';

const DRY = process.argv.includes('--dry-run');
const BATCH = 40;
const PAUSE_MS = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sameNum = (a, b) => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.round(Number(a)) === Math.round(Number(b));
};

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 25000 });

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
if (!src?.itemId) {
  console.error('No SharePoint source');
  process.exit(1);
}
console.log('source', src.fileName, DRY ? 'DRY-RUN' : 'APPLY');

const downloaded = await downloadDriveItemBuffer({
  itemId: src.itemId,
  driveId: src.driveId || undefined,
});
const { rows } = parseAlfaExcelBuffer(downloaded.buffer);
const allCases = await listAlfaCasosParaMatchExcel();
console.log('excel', rows.length, 'casos', allCases.length);

const updates = [];
for (const row of rows) {
  const p = row.payload || {};
  const excelInmueble = normalizeMoneyOficial(
    p.valorAseguradoInmueble,
    p.identificacion,
    'valorAseguradoInmueble'
  );
  const excelSid = normalizeMoneyOficial(p.valorAseguradoSid, p.identificacion, 'valorAseguradoSid');
  if (excelInmueble == null && excelSid == null) continue;
  const match = matchAlfaCaseForExcelRow(p, allCases);
  if (match.actionHint !== 'MATCH' || !match.cases?.length) continue;
  const caso = match.cases[0];
  updates.push({
    caseId: String(caso._id),
    excelInmueble,
    excelSid,
    rowNumber: row.rowNumber,
  });
}
console.log('candidates', updates.length);

let changed = 0;
let skipped = 0;
let processed = 0;

for (let i = 0; i < updates.length; i += BATCH) {
  const slice = updates.slice(i, i + BATCH);
  const ids = slice.map((u) => new mongoose.Types.ObjectId(u.caseId));
  const casos = await SegurosAlfaCaso.find({ _id: { $in: ids } })
    .select('_id consecutivo identificacion valorAseguradoInmueble valorAseguradoSid liquidador.encabezado')
    .lean();
  const byId = new Map(casos.map((c) => [String(c._id), c]));

  for (const u of slice) {
    const caso = byId.get(u.caseId);
    if (!caso) {
      skipped += 1;
      continue;
    }
    const enc = caso.liquidador?.encabezado || {};
    const patch = {};

    if (u.excelInmueble != null) {
      if (!sameNum(caso.valorAseguradoInmueble, u.excelInmueble)) {
        patch.valorAseguradoInmueble = u.excelInmueble;
      }
      if (caso.liquidador?.encabezado && !sameNum(enc.valorAseguradoInmueble, u.excelInmueble)) {
        patch['liquidador.encabezado.valorAseguradoInmueble'] = u.excelInmueble;
      }
    }
    if (u.excelSid != null) {
      // No poner cédula como SID
      const idn = Number(String(caso.identificacion || '').replace(/\D/g, ''));
      if (!(idn && Math.abs(u.excelSid - idn) <= 1)) {
        if (!sameNum(caso.valorAseguradoSid, u.excelSid)) {
          patch.valorAseguradoSid = u.excelSid;
        }
        if (caso.liquidador?.encabezado && !sameNum(enc.valorAseguradoSid, u.excelSid)) {
          patch['liquidador.encabezado.valorAseguradoSid'] = u.excelSid;
        }
      }
    }

    // Si SID en caso es la cédula y tenemos inmueble bueno, usar inmueble como SID
    const idn = Number(String(caso.identificacion || '').replace(/\D/g, ''));
    if (
      idn &&
      caso.valorAseguradoSid != null &&
      Math.abs(Number(caso.valorAseguradoSid) - idn) <= 1 &&
      u.excelInmueble != null
    ) {
      patch.valorAseguradoSid = u.excelInmueble;
      if (caso.liquidador?.encabezado) {
        patch['liquidador.encabezado.valorAseguradoSid'] = u.excelInmueble;
      }
    }

    if (!Object.keys(patch).length) {
      skipped += 1;
      continue;
    }
    changed += 1;
    if (changed <= 50) {
      console.log(
        JSON.stringify({
          consecutivo: caso.consecutivo,
          id: caso.identificacion,
          before: {
            inmueble: caso.valorAseguradoInmueble,
            sid: caso.valorAseguradoSid,
            liqInm: enc.valorAseguradoInmueble,
            liqSid: enc.valorAseguradoSid,
          },
          after: patch,
          row: u.rowNumber,
        })
      );
    }
    if (!DRY) {
      await SegurosAlfaCaso.updateOne({ _id: caso._id }, { $set: patch });
    }
  }

  processed += slice.length;
  console.log(`batch ${Math.floor(i / BATCH) + 1} ${processed}/${updates.length} changed=${changed}`);
  if (!DRY) await sleep(PAUSE_MS);
}

const monte = await SegurosAlfaCaso.findOne({ identificacion: '1130671024' })
  .select('consecutivo valorAseguradoInmueble valorAseguradoSid liquidador.encabezado.valorAseguradoInmueble liquidador.encabezado.valorAseguradoSid')
  .lean();
console.log('montealegre', JSON.stringify(monte, null, 2));
console.log(JSON.stringify({ DRY, candidates: updates.length, changed, skipped }, null, 2));
await mongoose.disconnect();
