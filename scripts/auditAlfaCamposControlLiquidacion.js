/**
 * Audita que los campos de control coincidan con el liquidador.
 * node scripts/auditAlfaCamposControlLiquidacion.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  extraerMontosLiquidadorAlfa,
  liquidadorAlfaTieneCifras,
} from '../utils/valoresLiquidadorAlfa.js';

await mongoose.connect(process.env.MONGO_URI);

const casos = await SegurosAlfaCaso.find({
  liquidador: { $exists: true, $ne: null, $type: 'object' },
})
  .select(
    'consecutivo identificacion valorAseguradoSid valorLiquidado valorReclamado reserva liquidadoCoberturaTerremo deducibleTerremoto valorLiquidacionCoberturasAdicionales deducibleCoberturasAdicionales valorTotalPagar liquidador'
  )
  .lean();

let conCifras = 0;
let ok = 0;
const errores = [];

for (const c of casos) {
  if (!liquidadorAlfaTieneCifras(c.liquidador)) continue;
  conCifras += 1;
  const m = extraerMontosLiquidadorAlfa(c.liquidador, c);
  const esperado = {
    liquidadoCoberturaTerremo: Math.round(Number(m.liquidadoCoberturaTerremo) || 0),
    deducibleTerremoto: Math.round(Number(m.deducibleTerremoto) || 0),
    valorLiquidacionCoberturasAdicionales: Math.round(
      Number(m.valorLiquidacionCoberturasAdicionales) || 0
    ),
    deducibleCoberturasAdicionales: Math.round(Number(m.deducibleCoberturasAdicionales) || 0),
    valorTotalPagar: Math.round(Number(m.valorTotalPagar) || 0),
  };
  const diffs = {};
  for (const [k, v] of Object.entries(esperado)) {
    const actual = c[k] == null || c[k] === '' ? null : Number(c[k]);
    if (actual !== v) diffs[k] = { actual, esperado: v };
  }
  if (Number(c.valorLiquidado) !== esperado.valorTotalPagar) {
    diffs.valorLiquidadoVsTotal = {
      valorLiquidado: c.valorLiquidado,
      valorTotalPagar: esperado.valorTotalPagar,
    };
  }
  if (Object.keys(diffs).length) {
    errores.push({ consecutivo: c.consecutivo, diffs, usaCotiz: m.usaCotiz });
  } else {
    ok += 1;
  }
}

const caso19 = casos.find((c) => c.consecutivo === 'ALFA-2026-08-19');
const m19 = caso19 ? extraerMontosLiquidadorAlfa(caso19.liquidador, caso19) : null;

console.log(
  JSON.stringify(
    {
      totalConLiquidador: casos.length,
      conCifras,
      ok,
      errores: errores.length,
      sampleErrores: errores.slice(0, 20),
      caso19: caso19
        ? {
            guardado: {
              valorLiquidado: caso19.valorLiquidado,
              reserva: caso19.reserva,
              liquidadoCoberturaTerremo: caso19.liquidadoCoberturaTerremo,
              deducibleTerremoto: caso19.deducibleTerremoto,
              valorLiquidacionCoberturasAdicionales:
                caso19.valorLiquidacionCoberturasAdicionales,
              deducibleCoberturasAdicionales: caso19.deducibleCoberturasAdicionales,
              valorTotalPagar: caso19.valorTotalPagar,
            },
            calculado: {
              subtotal: m19.subtotal,
              aiu: m19.aiu,
              liquidadoCoberturaTerremo: Math.round(m19.liquidadoCoberturaTerremo),
              deducibleTerremoto: Math.round(m19.deducibleTerremoto),
              valorTotalPagar: Math.round(m19.valorTotalPagar),
              usaCotiz: m19.usaCotiz,
            },
          }
        : null,
    },
    null,
    2
  )
);

await mongoose.disconnect();
process.exit(errores.length ? 1 : 0);
