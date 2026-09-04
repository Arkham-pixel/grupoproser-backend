import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import { extraerMontosLiquidadorAlfa, liquidadorAlfaTieneCifras } from '../utils/valoresLiquidadorAlfa.js';

await mongoose.connect(process.env.MONGO_URI);
const c = await SegurosAlfaCaso.findOne({ consecutivo: 'ALFA-2026-08-1458' }).lean();
if (!c) {
  console.log('NO_CASE');
  await mongoose.disconnect();
  process.exit(1);
}
const m = extraerMontosLiquidadorAlfa(c.liquidador, c);
const outbox = await AlfaExcelOutboundUpdate.find({ caseId: c._id })
  .sort({ updatedAt: -1 })
  .select('status lastError lastErrorCode attempts updatedAt changes match')
  .lean();
const latest = outbox[0];
const changeKeys = latest?.changes
  ? Object.keys(latest.changes instanceof Map ? Object.fromEntries(latest.changes) : latest.changes)
  : [];
console.log(
  JSON.stringify(
    {
      id: String(c._id),
      consecutivo: c.consecutivo,
      identificacion: c.identificacion,
      siniestro: c.siniestro || null,
      numeroPoliza: c.numeroPoliza || null,
      asegurado: c.asegurado,
      tomador: c.tomador,
      estado: c.estado,
      estadoGestion: c.estadoGestion,
      valorLiquidado: c.valorLiquidado,
      reserva: c.reserva,
      liquidadoCoberturaTerremo: c.liquidadoCoberturaTerremo,
      deducibleTerremoto: c.deducibleTerremoto,
      valorLiquidacionCoberturasAdicionales: c.valorLiquidacionCoberturasAdicionales,
      deducibleCoberturasAdicionales: c.deducibleCoberturasAdicionales,
      valorTotalPagar: c.valorTotalPagar,
      tieneLiquidador: Boolean(c.liquidador && typeof c.liquidador === 'object'),
      tieneCifras: liquidadorAlfaTieneCifras(c.liquidador),
      montosLiquidador: m
        ? {
            liquidadoCoberturaTerremo: m.liquidadoCoberturaTerremo,
            deducibleTerremoto: m.deducibleTerremoto,
            totalOtrosAmparos: m.totalOtrosAmparos,
            valorTotalPagar: m.valorTotalPagar,
          }
        : null,
      controlSeguimientoExcel: c.controlSeguimientoExcel || null,
      outboxN: outbox.length,
      latestOutbox: latest
        ? {
            status: latest.status,
            code: latest.lastErrorCode,
            error: latest.lastError,
            attempts: latest.attempts,
            updatedAt: latest.updatedAt,
            fields: changeKeys,
            row: latest.match?.excelRowNumber,
          }
        : null,
    },
    null,
    2
  )
);
await mongoose.disconnect();
