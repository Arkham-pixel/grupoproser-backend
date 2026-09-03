/**
 * Reactiva casos Alfa que el usuario re-agregó al Excel consolidado
 * (estaban soft-archivados por la base limpia) y alinea campos verdes.
 * No pisa avance ARNALD (estado, liquidador, fechas, docs).
 *
 *   node scripts/reactivateAlfaExcelReadded.js
 *   node scripts/reactivateAlfaExcelReadded.js --dry-run
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import {
  getAlfaRespaldoCollection,
  restoreAlfaCasoFromRespaldoById,
} from '../services/alfaCasosRespaldoService.js';
import {
  parseAlfaExcelBuffer,
  matchAlfaCaseForExcelRow,
} from '../services/alfaExcelImportService.js';
import {
  ALFA_EXCEL_APPEND_FIELDS,
  getOwnershipEntry,
} from '../config/alfaExcelOwnershipMap.js';
import {
  ALFA_EXCEL_DATE_FIELDS,
  ALFA_EXCEL_MONEY_FIELDS,
} from '../config/alfaExcelColumnMap.js';
import { normalizeExcelHeader } from '../utils/alfaExcelNormalize.js';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';
import {
  downloadDriveItemBuffer,
  getItemMetadata,
  replaceDriveItemContentBuffer,
} from '../services/microsoftGraphService.js';

const DRY = process.argv.includes('--dry-run');
const IDS = ['36861562', '387376'];

function toExcelCellValue(field, value) {
  if (value == null || value === '') return null;
  if (ALFA_EXCEL_DATE_FIELDS.includes(field)) {
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (ALFA_EXCEL_MONEY_FIELDS.includes(field)) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

function headerCellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) {
      return value.richText.map((p) => p.text || '').join('');
    }
  }
  return String(value);
}

function columnLetterToNumber(letter) {
  const s = String(letter || '').toUpperCase();
  let n = 0;
  for (let i = 0; i < s.length; i += 1) n = n * 26 + (s.charCodeAt(i) - 64);
  return n;
}

function resolveCol(headerRow, entry) {
  const aliases = [entry?.header, ...(entry?.headerAliases || [])]
    .filter(Boolean)
    .map((h) => normalizeExcelHeader(h));
  const maxCol = Math.max(40, headerRow.cellCount || 0);
  for (let c = 1; c <= maxCol; c += 1) {
    const norm = normalizeExcelHeader(headerCellText(headerRow.getCell(c).value));
    if (norm && aliases.includes(norm)) return c;
  }
  return entry?.column ? columnLetterToNumber(entry.column) : null;
}

await mongoose.connect(process.env.MONGO_URI);

const cfg = getAlfaExcelOutboundConfig();
const source = await AlfaExcelSharePointSource.findOne({
  integrationKey: cfg.integrationKey || 'alfa-excel-control-seguimiento',
});
if (!source?.itemId) throw new Error('No Excel source');

const meta = await getItemMetadata(source.itemId);
const driveId = meta.parentReference?.driveId || source.driveId;
const dl = await downloadDriveItemBuffer({ driveId, itemId: source.itemId });
const buf = dl.buffer || dl;
const parsed = parseAlfaExcelBuffer(buf);
const rows = (parsed.rows || []).filter((r) =>
  IDS.includes(String(r.payload?.identificacion || '').replace(/\D/g, ''))
);

console.log(
  JSON.stringify({
    event: 'START',
    dryRun: DRY,
    excelFile: source.fileName,
    excelTotal: parsed.rows?.length,
    targetRows: rows.map((r) => ({
      row: r.rowNumber,
      id: r.payload?.identificacion,
      asegurado: r.payload?.asegurado,
      estadoExcel: r.payload?.estado,
    })),
  })
);

const results = [];

for (const row of rows) {
  const payload = row.payload || {};
  const id = String(payload.identificacion || '').replace(/\D/g, '');
  let caso = await SegurosAlfaCaso.findOne({ identificacion: id });
  if (!caso) {
    caso = await SegurosAlfaCaso.findOne({
      identificacion: id,
      excluidoBaseAlfa: true,
    });
  }
  if (!caso) {
    const respaldo = await getAlfaRespaldoCollection().findOne({ identificacion: id });
    if (respaldo) {
      if (!DRY) {
        await restoreAlfaCasoFromRespaldoById(respaldo._id, { unexclude: true });
      }
      caso = DRY
        ? respaldo
        : await SegurosAlfaCaso.findById(respaldo._id);
    }
  }
  if (!caso) {
    results.push({ id, action: 'NOT_FOUND_IN_ARNALD' });
    continue;
  }

  const before = {
    consecutivo: caso.consecutivo,
    excluido: caso.excluidoBaseAlfa === true,
    estado: caso.estado,
  };

  const $set = {
    excluidoBaseAlfa: false,
  };

  // Solo campos owner=alfa desde Excel
  for (const field of ALFA_EXCEL_APPEND_FIELDS) {
    const entry = getOwnershipEntry(field);
    if (!entry || entry.owner !== 'alfa') continue;
    if (payload[field] == null || payload[field] === '') continue;
    $set[field] = payload[field];
  }

  if (!DRY) {
    await SegurosAlfaCaso.updateOne(
      { _id: caso._id },
      {
        $set,
        $unset: { excluidoBaseAlfaAt: 1, excluidoBaseAlfaReason: 1 },
      }
    );
    caso = await SegurosAlfaCaso.findById(caso._id);
  }

  results.push({
    id,
    consecutivo: caso.consecutivo,
    asegurado: caso.asegurado,
    action: DRY ? 'WOULD_REACTIVATE' : 'REACTIVATED',
    before,
    estadoKept: caso.estado,
    alfaFieldsApplied: Object.keys($set).filter(
      (k) => !k.startsWith('excluido')
    ),
  });
}

// Reescribir en Excel las columnas ARNALD (amarillas) de esas filas
if (!DRY && results.some((r) => r.action === 'REACTIVATED')) {
  const far = new Date(Date.now() + 2 * 60 * 60 * 1000);
  await AlfaExcelOutboundUpdate.updateMany(
    { status: { $in: ['pending', 'processing', 'retry'] } },
    { $set: { status: 'pending', nextRetryAt: far } }
  );

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws =
    wb.getWorksheet('BD') ||
    wb.worksheets.find((w) => String(w.name).toUpperCase() === 'BD') ||
    wb.worksheets[0];
  const headerRow = ws.getRow(1);

  for (const row of rows) {
    const id = String(row.payload?.identificacion || '').replace(/\D/g, '');
    const caso = await SegurosAlfaCaso.findOne({ identificacion: id }).lean();
    if (!caso) continue;
    const excelRow = ws.getRow(row.rowNumber);
    for (const field of ALFA_EXCEL_APPEND_FIELDS) {
      const entry = getOwnershipEntry(field);
      if (!entry || entry.owner !== 'arnald') continue;
      const val = toExcelCellValue(field, caso[field]);
      if (val == null || val === '') continue;
      const col = resolveCol(headerRow, entry);
      if (!col) continue;
      excelRow.getCell(col).value = val;
    }
  }

  const outBuf = Buffer.from(await wb.xlsx.writeBuffer());
  const metaBefore = await getItemMetadata(source.itemId);
  const uploaded = await replaceDriveItemContentBuffer({
    driveId,
    itemId: source.itemId,
    buffer: outBuf,
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ifMatch: metaBefore.eTag,
  });
  source.eTag = uploaded?.eTag || source.eTag;
  source.lastArnaldWrittenEtag = uploaded?.eTag || source.lastArnaldWrittenEtag;
  await source.save();
  console.log(
    JSON.stringify({
      event: 'EXCEL_UPDATED',
      file: source.fileName,
      eTag: source.eTag,
    })
  );
}

const active = await SegurosAlfaCaso.countDocuments({
  $or: [{ excluidoBaseAlfa: { $exists: false } }, { excluidoBaseAlfa: false }],
});

console.log(
  JSON.stringify(
    {
      event: 'DONE',
      dryRun: DRY,
      results,
      activeArnald: active,
    },
    null,
    2
  )
);

await mongoose.disconnect();
