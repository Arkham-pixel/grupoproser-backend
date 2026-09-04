/**
 * Verifica en Excel vivo (SharePoint) 5 casos con control vs Mongo.
 * node scripts/verifyAlfaExcelControlLive.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { resolveDriveContext, downloadDriveItemBuffer } from '../services/microsoftGraphService.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import { findExcelRowForCase } from '../services/alfaExcelOutboundService.js';
import { normalizeIdentification } from '../utils/alfaExcelNormalize.js';

const SAMPLE = [
  'ALFA-2026-08-1458', // Solarte — usuario
  'ALFA-2026-08-8',
  'ALFA-2026-08-19',
  'ALFA-2026-08-12',
  'ALFA-2026-08-4',
];

await mongoose.connect(process.env.MONGO_URI);
const casos = await SegurosAlfaCaso.find({ consecutivo: { $in: SAMPLE } }).lean();
const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
const ctx = await resolveDriveContext();
const dl = await downloadDriveItemBuffer({
  driveId: src.driveId || ctx.driveId,
  itemId: src.itemId,
});
const parsed = parseAlfaExcelBuffer(dl.buffer);

const results = [];
for (const c of casos) {
  let hit = null;
  let err = null;
  try {
    hit = findExcelRowForCase(c, parsed.rows);
  } catch (e) {
    err = e.code || e.message;
  }
  const row = hit ? parsed.rows.find((r) => r.rowNumber === hit.rowNumber) : null;
  const p = row?.payload || {};
  const near = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 2;
  results.push({
    consecutivo: c.consecutivo,
    excelRow: hit?.rowNumber || null,
    matchErr: err,
    ok: {
      liquidadoCobertura: near(c.liquidadoCoberturaTerremo, p.liquidadoCoberturaTerremo),
      deducible: near(c.deducibleTerremoto, p.deducibleTerremoto),
      adicionales: near(c.valorLiquidacionCoberturasAdicionales, p.valorLiquidacionCoberturasAdicionales),
      totalPagar: near(c.valorTotalPagar, p.valorTotalPagar),
      reserva: near(c.reserva, p.reserva),
      valorLiquidado: near(c.valorLiquidado, p.valorLiquidado),
    },
    mongo: {
      liquidadoCoberturaTerremo: c.liquidadoCoberturaTerremo,
      deducibleTerremoto: c.deducibleTerremoto,
      totalPagar: c.valorTotalPagar,
      reserva: c.reserva,
    },
    excel: {
      liquidadoCoberturaTerremo: p.liquidadoCoberturaTerremo ?? null,
      deducibleTerremoto: p.deducibleTerremoto ?? null,
      totalPagar: p.valorTotalPagar ?? null,
      reserva: p.reserva ?? null,
      estado: p.estado ?? null,
      fechaInspeccion: p.fechaInspeccion ?? null,
    },
  });
}

const last9 = [
  'ALFA-2026-08-72',
  'ALFA-2026-08-121',
  'ALFA-2026-08-1977',
];
const lastCasos = await SegurosAlfaCaso.find({ consecutivo: { $in: last9 } }).lean();
for (const c of lastCasos) {
  let hit = null;
  try {
    hit = findExcelRowForCase(c, parsed.rows);
  } catch (e) {
    results.push({ consecutivo: c.consecutivo, matchErr: e.code || e.message });
    continue;
  }
  const p = parsed.rows.find((r) => r.rowNumber === hit.rowNumber)?.payload || {};
  results.push({
    consecutivo: c.consecutivo,
    excelRow: hit.rowNumber,
    sampleLast9: true,
    excelTotal: p.valorTotalPagar ?? null,
    excelLiqCob: p.liquidadoCoberturaTerremo ?? null,
    mongoTotal: c.valorTotalPagar,
  });
}

console.log(JSON.stringify({ file: src.fileName, results }, null, 2));
await mongoose.disconnect();
