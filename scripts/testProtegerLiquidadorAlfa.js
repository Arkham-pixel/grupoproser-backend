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

const editado = {
  ...conItems,
  detalleLiquidacionCat: [{ concepto: 'Muro', valorPerdida: 999 }],
};
const resueltoEdit = resolverLiquidadorParaUpdate(editado, conItems);
assert(
  resueltoEdit?.detalleLiquidacionCat?.[0]?.valorPerdida === 999,
  'edicion con contenido debe persistir tal cual'
);

const conDosItems = {
  modelo: 'nsr10',
  evaluacionSismicaNSR10: {
    presupuesto: {
      items: [
        { actividad: 'Muro', cantidad: 1, valorUnitario: 100 },
        { actividad: 'Techo', cantidad: 1, valorUnitario: 200 },
      ],
    },
  },
};
const editadoMenosItems = {
  modelo: 'nsr10',
  evaluacionSismicaNSR10: {
    presupuesto: {
      items: [{ actividad: 'Muro editado', cantidad: 2, valorUnitario: 50 }],
    },
  },
};
const resueltoMenos = resolverLiquidadorParaUpdate(editadoMenosItems, conDosItems);
assert(
  resueltoMenos?.evaluacionSismicaNSR10?.presupuesto?.items?.length === 1,
  'CAT/Alfa: editar con menos ítems debe persistir (no restaurar copia inicial)'
);
assert(
  resueltoMenos?.evaluacionSismicaNSR10?.presupuesto?.items?.[0]?.actividad === 'Muro editado',
  'CAT/Alfa: valores editados deben persistir'
);
const restaurariaCopia = preservarPresupuestoNsrSiVacio(editadoMenosItems, conDosItems);
assert(
  restaurariaCopia?.evaluacionSismicaNSR10?.presupuesto?.items?.length === 2,
  'preservar (viejo) sí restauraría la copia inicial; por eso CAT no debe usarlo al editar'
);

const informeLleno = {
  descripcionDanios: 'Daños estructurales observados en muros y cubiertas del predio asegurado.',
  conclusiones: 'Se recomienda continuar con la recolección documental y la liquidación.',
};
const informeVacio = { analisisGeneral: {}, descripcionDanios: '' };
assert(
  resolverInformeUnicoParaUpdate(informeVacio, informeLleno) === informeLleno,
  'informe vacio no pisa'
);

console.log('OK protegerPresupuestoNsr10');
