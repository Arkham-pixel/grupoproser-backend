import '../config/loadEnv.js';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import EquidadFdmExcelSharePointSource from '../models/EquidadFdmExcelSharePointSource.js';
import { getEquidadFdmExcelSharePointConfig } from '../config/equidadFdmExcelSharePoint.js';
import {
  replaceDriveItemContentBuffer,
  getItemMetadata,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const FILE = path.resolve('C:/Users/GP-TI/Downloads/BASE_TERREMOTO_REPARADO_ABRIR.xlsx');

function headerText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
  }
  return String(value);
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(FILE);
const ws = wb.worksheets[0];

const AJ_COL = 41;
ws.getRow(1).getCell(AJ_COL).value = 'Ajustador';
ws.getRow(1).getCell(AJ_COL).font = { bold: true };

const casos = await EquidadFdmCaso.find({
  ajustador: { $nin: [null, ''] },
  evento: /TERREMOTO/i,
}).lean();

let filled = 0;
for (const caso of casos) {
  const target = String(caso.cedula || '').replace(/\D/g, '');
  if (!target) continue;
  if (/sistema\s*osiris|^(CLL|CRA|CALLE|CARRERA|MANZANA|SUBA)/i.test(String(caso.ajustador))) {
    continue;
  }
  for (let r = 2; r <= (ws.rowCount || 0); r += 1) {
    const dig = String(headerText(ws.getRow(r).getCell(3).value) || '').replace(/\D/g, '');
    if (dig && dig === target) {
      ws.getRow(r).getCell(AJ_COL).value = caso.ajustador;
      ws.getRow(r).hidden = false;
      filled += 1;
      break;
    }
  }
}

for (let r = 1; r <= (ws.rowCount || 0); r += 1) ws.getRow(r).hidden = false;
ws.autoFilter = undefined;

await wb.xlsx.writeFile(FILE);
const buf = fs.readFileSync(FILE);
console.log({ filled, bytes: buf.length });

const cfg = getEquidadFdmExcelSharePointConfig();
const source = await EquidadFdmExcelSharePointSource.findOne({
  integrationKey: cfg.integrationKey,
});
const { driveId } = await resolveDriveContext();
const meta = await getItemMetadata(source.itemId);
const uploaded = await replaceDriveItemContentBuffer({
  driveId: source.driveId || driveId,
  itemId: source.itemId,
  buffer: buf,
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ifMatch: meta.eTag,
});
source.eTag = uploaded?.eTag || meta.eTag;
source.lastArnaldWrittenEtag = source.eTag;
source.lastSyncAt = new Date();
await source.save();
console.log('UPLOAD_OK', source.eTag);
await mongoose.disconnect();
