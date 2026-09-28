/**
 * Centavos concatenados por debajo de mil millones (7.597.812,12 → 759.781.212).
 * node scripts/testAlfaInfladoVsLiquidador.mjs
 */
import {
  aplicarMontosOficialesDesdeLiquidadorAlfa,
  extraerMontosLiquidadorAlfa,
  pareceInfladoPorCentavos,
} from '../utils/valoresLiquidadorAlfa.js';
import { pareceIdentificacionComoMontoAlfa, pesosOficialesAlfa } from '../utils/alfaExcelNormalize.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(pareceInfladoPorCentavos(759_781_212, 7_597_812), '759.781.212 es 7.597.812 ×100');
assert(pareceInfladoPorCentavos(677_872_603, 7_073_453), '×96 sigue siendo centavos pegados');
assert(!pareceInfladoPorCentavos(102_616_416, 17_102_736), '×6 no se parte sin más evidencia');
assert(pareceInfladoPorCentavos(759_781_212, 7_597_812.12), 'tolerancia 2% vs centavos');
assert(!pareceInfladoPorCentavos(16_205_378, 16_205_378), 'liquidado ya correcto');
assert(!pareceInfladoPorCentavos(499_268_321, 7_597_812), 'SID real no es ×100 de 7.5M');
assert(
  !pareceIdentificacionComoMontoAlfa(759_781_212, '1118293088'),
  '759 millones no es la cédula'
);
assert(pesosOficialesAlfa(759_781_212) === 759_781_212, 'sin referencia no divide < 1e9');
assert(pesosOficialesAlfa(1_118_293_088, '1118293088') == null, 'cédula no se divide');

const liquidador = {
  detalleLiquidacionCat: [{ descripcion: 'Reparación muros', valorPerdida: 6_331_510 }],
  evaluacionSismicaNSR10: { presupuesto: { aiuPorcentaje: 0.2 } },
};
const montos = extraerMontosLiquidadorAlfa(liquidador, {});
const recOk = Math.round(montos.valorReclamado);
const liqOk = Math.round(montos.valorLiquidado);
assert(recOk === 7_597_812, `reclamado ${montos.valorReclamado}`);
assert(liqOk === 7_597_812, `liquidado ${montos.valorLiquidado}`);

const sanado = aplicarMontosOficialesDesdeLiquidadorAlfa({
  liquidador,
  valorReclamado: 14_361_802,
  valorLiquidado: 759_781_212,
});
assert(sanado.valorReclamado === recOk, `reclamado desde liquidador → ${sanado.valorReclamado}`);
assert(sanado.valorLiquidado === liqOk, `liquidado inflado → ${sanado.valorLiquidado}`);
assert(sanado.valorTotalPagar === liqOk, `total a pagar → ${sanado.valorTotalPagar}`);
assert(sanado.reserva === liqOk, `reserva → ${sanado.reserva}`);

const sidReal = aplicarMontosOficialesDesdeLiquidadorAlfa({
  liquidador,
  valorReclamado: 7_597_812,
  valorLiquidado: 200_000_000,
});
assert(sidReal.valorLiquidado === liqOk, 'liquidado siempre desde liquidador');

const ceroPorDed = aplicarMontosOficialesDesdeLiquidadorAlfa({
  liquidador: {
    detalleLiquidacionCat: [{ descripcion: 'Piso madera', valorPerdida: 223_640 }],
    evaluacionSismicaNSR10: { presupuesto: { aiuPorcentaje: 0.2 } },
  },
  valorAseguradoSid: 298_023_989,
  valorReclamado: 25_830_408,
  valorLiquidado: 25_830_408,
});
assert(ceroPorDed.valorReclamado === 268_368, `reclamado ×96 → ${ceroPorDed.valorReclamado}`);
assert(ceroPorDed.valorLiquidado === 0, 'liquidado inflado con recálculo 0 por deducible');

/** AIU 0% explícito (cotización) no debe caer al default 20%. */
const montosAiu0 = extraerMontosLiquidadorAlfa(
  {
    cotizacionesPdf: {
      materiales: { montoFinal: '4.958.160', usarComoBasePresupuesto: true },
      manoObra: { montoFinal: '7.887.000', usarComoBasePresupuesto: true },
    },
    liquidacionCotizacionPdf: {
      aiuPorcentaje: 0,
      deducibleConfig: {
        aplica: true,
        modo: 'max_pct_minimo',
        porcentaje: 2,
        cantidadSMMLV: 2,
        valorSMMLV: 1_750_905,
        baseDeducible: 'valor_asegurable',
      },
    },
    liquidacionCatastrofico: { valorAsegurado: 157_806_584 },
    encabezado: { valorAseguradoSid: 157_806_584 },
  },
  { valorAseguradoSid: 157_806_584 }
);
assert(montosAiu0.subtotal === 12_845_160, `subtotal aiu0 ${montosAiu0.subtotal}`);
assert(montosAiu0.aiu === 0, `aiu debe ser 0, got ${montosAiu0.aiu}`);
assert(montosAiu0.aiuPct === 0, `aiuPct debe ser 0, got ${montosAiu0.aiuPct}`);
assert(montosAiu0.valorLiquidado === 9_343_350, `liquidado aiu0 ${montosAiu0.valorLiquidado}`);
assert(montosAiu0.valorTotalPagar === 9_343_350, `total aiu0 ${montosAiu0.valorTotalPagar}`);

/** Con cotización: SID de liquidacionCotizacionPdf (no el encabezado ×2). */
const montosSidCotiz = extraerMontosLiquidadorAlfa(
  {
    cotizacionesPdf: {
      completo: { montoFinal: '5.520.000', usarComoBasePresupuesto: true },
    },
    liquidacionCotizacionPdf: {
      aiuPorcentaje: 0,
      valorAseguradoSid: '1.235.778.238',
      deducibleConfig: {
        aplica: true,
        modo: 'max_pct_minimo',
        porcentaje: 2,
        cantidadSMMLV: 2,
        valorSMMLV: 1_750_905,
        baseDeducible: 'valor_asegurable',
      },
    },
    encabezado: { valorAseguradoSid: 2_471_556_476 },
    liquidacionCatastrofico: { valorAsegurado: 12_357_782 },
  },
  { valorAseguradoSid: 2_471_556_476 }
);
assert(montosSidCotiz.sid === 1_235_778_238, `sid cotiz ${montosSidCotiz.sid}`);
assert(Math.round(montosSidCotiz.deducible) === 24_715_565, `deducible ${montosSidCotiz.deducible}`);
assert(montosSidCotiz.subtotal === 5_520_000, `subtotal ${montosSidCotiz.subtotal}`);
assert(montosSidCotiz.aiu === 0, `aiu ${montosSidCotiz.aiu}`);
assert(montosSidCotiz.valorLiquidado === 0, 'liquidado 0 por deducible > daños');
assert(
  Math.round(aplicarMontosOficialesDesdeLiquidadorAlfa({
    liquidador: {
      cotizacionesPdf: {
        completo: { montoFinal: '5.520.000', usarComoBasePresupuesto: true },
      },
      liquidacionCotizacionPdf: {
        aiuPorcentaje: 0,
        valorAseguradoSid: '1.235.778.238',
        deducibleConfig: {
          aplica: true,
          porcentaje: 2,
          cantidadSMMLV: 2,
          valorSMMLV: 1_750_905,
          baseDeducible: 'valor_asegurable',
        },
      },
      encabezado: { valorAseguradoSid: 2_471_556_476 },
    },
    valorAseguradoSid: 2_471_556_476,
    deducibleTerremoto: 49_431_130,
    valorReclamado: 6_624_000,
  }).deducibleTerremoto) === 24_715_565,
  'heal deducible ×2 SID'
);
console.log('OK testAlfaInfladoVsLiquidador');
