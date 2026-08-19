/**
 * Repara BASE TERREMOTO: destapa filas/columnas ocultas y limpia filtros rotos
 * que hacen fallar Excel Online ("Can't display a hidden grid").
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import EquidadFdmExcelSharePointSource from '../models/EquidadFdmExcelSharePointSource.js';
import { getEquidadFdmExcelSharePointConfig } from '../config/equidadFdmExcelSharePoint.js';
import {
  downloadDriveItemBuffer,
  replaceDriveItemContentBuffer,
  getItemMetadata,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);
await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const cfg = getEquidadFdmExcelSharePointConfig();
const source = await EquidadFdmExcelSharePointSource.findOne({
  integrationKey: cfg.integrationKey,
});
if (!source?.itemId) {
  console.error('NO_ITEM');
  process.exit(1);
}

const { driveId } = await resolveDriveContext();
const drive = source.driveId || driveId;
const downloaded = await downloadDriveItemBuffer({ driveId: drive, itemId: source.itemId });
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(downloaded?.buffer || downloaded);

let fixedSheets = 0;
for (const ws of wb.worksheets) {
  let hiddenRows = 0;
  let zeroHeight = 0;
  const maxRow = Math.max(ws.rowCount || 0, 1);
  for (let r = 1; r <= maxRow; r += 1) {
    const row = ws.getRow(r);
    if (row.hidden) {
      row.hidden = false;
      hiddenRows += 1;
    }
    if (row.height === 0) {
      row.height = 15;
      zeroHeight += 1;
    }
  }

  let hiddenCols = 0;
  const maxCol = Math.max(ws.columnCount || 0, 50);
  for (let c = 1; c <= maxCol; c += 1) {
    const col = ws.getColumn(c);
    if (col.hidden) {
      col.hidden = false;
      hiddenCols += 1;
    }
    if (col.width === 0) {
      col.width = 12;
    }
  }

  // Quitar autoFilter si deja la vista “sin filas” en Excel Online
  if (ws.autoFilter) {
    ws.autoFilter = undefined;
  }

  // Asegurar que la hoja esté visible
  if (ws.state === 'hidden' || ws.state === 'veryHidden') {
    ws.state = 'visible';
  }

  console.log(
    JSON.stringify({
      sheet: ws.name,
      maxRow,
      hiddenRows,
      zeroHeight,
      hiddenCols,
      state: ws.state,
    })
  );
  fixedSheets += 1;
}

const outBuf = Buffer.from(await wb.xlsx.writeBuffer());
try {
  const meta = await getItemMetadata(source.itemId);
  const uploaded = await replaceDriveItemContentBuffer({
    driveId: drive,
    itemId: source.itemId,
    buffer: outBuf,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ifMatch: meta.eTag,
  });
  source.eTag = uploaded?.eTag || meta.eTag;
  source.lastArnaldWrittenEtag = source.eTag;
  source.lastSyncAt = new Date();
  await source.save();
  console.log('UPLOAD_OK', { eTag: source.eTag, bytes: outBuf.length, fixedSheets });
} catch (err) {
  console.error('UPLOAD_FAIL', err.code || '', err.message);
  process.exitCode = 1;
}

await mongoose.disconnect();
