import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { resolveDriveContext, downloadDriveItemBuffer } from '../services/microsoftGraphService.js';
import { parseAlfaExcelBuffer, matchAlfaCaseForExcelRow } from '../services/alfaExcelImportService.js';
import { findExcelRowForCase } from '../services/alfaExcelOutboundService.js';
import { normalizeIdentification } from '../utils/alfaExcelNormalize.js';

await mongoose.connect(process.env.MONGO_URI);

const caso = await SegurosAlfaCaso.findOne({ consecutivo: 'ALFA-2026-08-1458' }).lean();
const pending = await AlfaExcelOutboundUpdate.countDocuments({
  status: { $in: ['pending', 'processing'] },
});
const sinSin = await SegurosAlfaCaso.countDocuments({
  $or: [{ siniestro: null }, { siniestro: '' }, { siniestro: { $exists: false } }],
});
const total = await SegurosAlfaCaso.countDocuments();

const src = await AlfaExcelSharePointSource.findOne({
  integrationKey: 'alfa-excel-control-seguimiento',
}).lean();
const ctx = await resolveDriveContext();
const dl = await downloadDriveItemBuffer({
  driveId: src.driveId || ctx.driveId,
  itemId: src.itemId,
});
const parsed = parseAlfaExcelBuffer(dl.buffer);
const id = normalizeIdentification(caso.identificacion);
const excelHits = parsed.rows.filter(
  (r) => normalizeIdentification(r.payload?.identificacion) === id
);

let outboundMatch = null;
try {
  outboundMatch = findExcelRowForCase(caso, parsed.rows);
} catch (e) {
  outboundMatch = { error: e.code || e.message };
}

const excelSummary = excelHits.map((r) => ({
  row: r.rowNumber,
  siniestro: r.payload.siniestro || null,
  poliza: r.payload.numeroPoliza || null,
  reserva: r.payload.reserva ?? null,
  valorLiquidado: r.payload.valorLiquidado ?? null,
  liquidadoCoberturaTerremo: r.payload.liquidadoCoberturaTerremo ?? null,
  deducibleTerremoto: r.payload.deducibleTerremoto ?? null,
  valorLiquidacionCoberturasAdicionales: r.payload.valorLiquidacionCoberturasAdicionales ?? null,
  deducibleCoberturasAdicionales: r.payload.deducibleCoberturasAdicionales ?? null,
  valorTotalPagar: r.payload.valorTotalPagar ?? null,
  matchVsCase: matchAlfaCaseForExcelRow(r.payload, [caso]),
}));

console.log(
  JSON.stringify(
    {
      mongo: {
        siniestro: caso.siniestro || null,
        poliza: caso.numeroPoliza,
        valorTotalPagar: caso.valorTotalPagar,
        liquidadoCoberturaTerremo: caso.liquidadoCoberturaTerremo,
        ajustadorLider: caso.ajustadorLider || null,
        ajustador: caso.ajustador || null,
      },
      colaPendiente: pending,
      casosSinSiniestro: sinSin,
      totalCasos: total,
      excelHits: excelSummary,
      outboundMatch,
      mappingControl: {
        Y: parsed.mapping?.liquidadoCoberturaTerremo,
        Z: parsed.mapping?.deducibleTerremoto,
        AA: parsed.mapping?.valorLiquidacionCoberturasAdicionales,
        siniestroCol: parsed.mapping?.siniestro,
      },
    },
    null,
    2
  )
);

await mongoose.disconnect();
