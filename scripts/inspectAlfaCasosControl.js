import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { extraerMontosLiquidadorAlfa } from '../utils/valoresLiquidadorAlfa.js';

await mongoose.connect(process.env.MONGO_URI);
const ids = [
  'ALFA-2026-08-143',
  'ALFA-2026-08-75',
  'ALFA-2026-08-72',
  'ALFA-2026-08-1406',
  'ALFA-2026-08-1370',
  'ALFA-2026-08-1400',
];
const casos = await SegurosAlfaCaso.find({ consecutivo: { $in: ids } }).lean();
for (const c of casos) {
  const m = extraerMontosLiquidadorAlfa(c.liquidador, c);
  const cot = c.liquidador?.cotizacionesPdf || {};
  const cfg =
    c.liquidador?.liquidacionCotizacionPdf?.deducibleConfig ||
    c.liquidador?.liquidacionCatastrofico?.deducibleConfig;
  console.log(
    JSON.stringify(
      {
        consecutivo: c.consecutivo,
        valorLiquidado: c.valorLiquidado,
        control: {
          liquidadoCoberturaTerremo: c.liquidadoCoberturaTerremo,
          valorTotalPagar: c.valorTotalPagar,
        },
        montos: {
          subtotal: m.subtotal,
          aiu: m.aiu,
          deducible: m.deducible,
          otros: m.totalOtrosAmparos,
          total: m.valorTotalPagar,
          usaCotiz: m.usaCotiz,
          sid: m.sid,
        },
        cotizacion: {
          materiales: cot.materiales?.montoFinal,
          manoObra: cot.manoObra?.montoFinal,
          completo: cot.completo?.montoFinal,
          alias: c.liquidador?.cotizacionPdf?.montoFinal,
          usarCompleto: cot.completo?.usarComoBasePresupuesto,
        },
        cfgDed: cfg
          ? {
              pct: cfg.porcentaje,
              base: cfg.baseDeducible,
              smmlv: cfg.cantidadSMMLV,
            }
          : null,
        nDetalle: Array.isArray(c.liquidador?.detalleLiquidacionCat)
          ? c.liquidador.detalleLiquidacionCat.length
          : null,
        nItems: c.liquidador?.evaluacionSismicaNSR10?.presupuesto?.items?.length || 0,
      },
      null,
      2
    )
  );
}
await mongoose.disconnect();
