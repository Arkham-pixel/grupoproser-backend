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
assert(sanado.valorReclamado === 14_361_802, 'reclamado real no se toca');
assert(sanado.valorLiquidado === liqOk, `liquidado inflado → ${sanado.valorLiquidado}`);

const sidReal = aplicarMontosOficialesDesdeLiquidadorAlfa({
  liquidador,
  valorReclamado: 7_597_812,
  valorLiquidado: 200_000_000,
});
assert(sidReal.valorLiquidado === 200_000_000, '200 millones reales no se parten');

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

console.log('OK testAlfaInfladoVsLiquidador');
