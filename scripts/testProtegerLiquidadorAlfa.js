import {
  preservarPresupuestoNsrSiVacio,
  resolverLiquidadorParaUpdate,
  resolverInformeUnicoParaUpdate,
  scoreContenidoLiquidadorNsr,
} from '../utils/protegerPresupuestoNsr10.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const conItems = {
  modelo: 'nsr10',
  evaluacionSismicaNSR10: {
    presupuesto: {
      items: [{ actividad: 'Muro', cantidad: 1, valorUnitario: 100 }],
    },
  },
  detalleLiquidacionCat: [{ concepto: 'Muro', valorPerdida: 100 }],
};

const vacio = {
  modelo: 'nsr10',
  evaluacionSismicaNSR10: { presupuesto: { items: [] } },
  detalleLiquidacionCat: [],
};

assert(scoreContenidoLiquidadorNsr(conItems) === 2, 'score con items');
assert(scoreContenidoLiquidadorNsr(vacio) === 0, 'score vacio');

const kept = preservarPresupuestoNsrSiVacio(vacio, conItems);
assert(scoreContenidoLiquidadorNsr(kept) === 2, 'preservar no debe vaciar');

assert(
  scoreContenidoLiquidadorNsr(resolverLiquidadorParaUpdate(vacio, conItems)) === 2,
  'resolver vacio vs lleno'
);
assert(
  scoreContenidoLiquidadorNsr(resolverLiquidadorParaUpdate(null, conItems)) === 2,
  'resolver null vs lleno'
);
assert(resolverLiquidadorParaUpdate(undefined, conItems) === conItems, 'resolver undefined');

const informeLleno = { analisisGeneral: { descripcionEvento: 'Terremoto' }, fotosInspeccion: [{}] };
const informeVacio = { analisisGeneral: {} };
assert(
  resolverInformeUnicoParaUpdate(informeVacio, informeLleno) === informeLleno,
  'informe vacio no pisa'
);

console.log('OK protegerPresupuestoNsr10');
