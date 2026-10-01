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

// Borrar ítems del detalle (array explícito más corto) debe persistir
const conDetalleTres = {
  modelo: 'nsr10',
  evaluacionSismicaNSR10: {
    presupuesto: {
      items: [
        { actividad: 'A', cantidad: 1, valorUnitario: 10 },
        { actividad: 'B', cantidad: 1, valorUnitario: 20 },
        { actividad: 'C', cantidad: 1, valorUnitario: 30 },
      ],
    },
  },
  detalleLiquidacionCat: [
    { descripcion: 'A', valorPerdida: 10 },
    { descripcion: 'B', valorPerdida: 20 },
    { descripcion: 'C', valorPerdida: 30 },
  ],
};
const detalleConUno = {
  modelo: 'nsr10',
  evaluacionSismicaNSR10: {
    presupuesto: {
      items: [{ actividad: 'B', cantidad: 1, valorUnitario: 20 }],
    },
  },
  detalleLiquidacionCat: [{ descripcion: 'B', valorPerdida: 20 }],
};
const resueltoBorrado = resolverLiquidadorParaUpdate(detalleConUno, conDetalleTres);
assert(
  resueltoBorrado?.detalleLiquidacionCat?.length === 1,
  'borrar ítems del detalle debe persistir'
);
assert(
  resueltoBorrado?.evaluacionSismicaNSR10?.presupuesto?.items?.length === 1,
  'presupuesto espejo del detalle borrado debe persistir'
);

const preservarOmitido = preservarPresupuestoNsrSiVacio(
  { modelo: 'nsr10', encabezado: { asegurado: 'X' } },
  conDosItems
);
assert(
  preservarOmitido?.evaluacionSismicaNSR10?.presupuesto?.items?.length === 2,
  'preservar: si el entrante OMITIÓ presupuesto, se conserva el guardado'
);

const soloPdf = {
  modelo: 'nsr10',
  cotizacionesPdf: {
    completo: { montoFinal: '26900000', paginas: [{ ruta: '/x.pdf' }] },
  },
};
assert(scoreContenidoLiquidadorNsr(soloPdf) > 0, 'cotización PDF cuenta como contenido');
assert(
  resolverLiquidadorParaUpdate(soloPdf, vacio)?.cotizacionesPdf?.completo?.montoFinal ===
    '26900000',
  'PDF-only debe persistir (no descartarse como vacío)'
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

const informeAllianzLleno = {
  descripcionDanios: 'Grietas en muros de mampostería y desprendimiento de pañetes en fachada.',
  analisisNexoCausal: 'Los daños observados son consistentes con el sismo reportado en la póliza.',
  conclusiones: 'Se recomienda liquidar conforme al presupuesto de reparación NSR-10.',
  filasDanios: [{ zona: 'Fachada', condicion: 'Grieta diagonal de 2 mm', nivel: 'MEDIO' }],
};
const informeAllianzCascaron = {
  infoEvento: 'El presente informe se elabora en el marco de la atención del evento sísmico.',
  descripcionDanios: '',
  conclusiones: '',
  filasDanios: [],
  filasPolizaCobertura: [],
};
assert(
  resolverInformeUnicoParaUpdate(informeAllianzCascaron, informeAllianzLleno) ===
    informeAllianzLleno,
  'cascarón Allianz con infoEvento default no pisa textos reales'
);

// AIU 0% (cotización PDF): no perder al omitir aiuPorcentaje en el payload entrante.
const conAiu0 = {
  modelo: 'nsr10',
  cotizacionesPdf: {
    completo: { montoFinal: 5000000, usarComoBasePresupuesto: true, paginas: [{ ruta: '/a.pdf' }] },
  },
  liquidacionCotizacionPdf: {
    aiuPorcentaje: 0,
    valorAseguradoSid: 100000000,
    deducibleConfig: { porcentaje: 2, cantidadSMMLV: 2, baseDeducible: 'valor_asegurable' },
  },
};
const sinAiuEnPayload = {
  ...conAiu0,
  liquidacionCotizacionPdf: {
    valorAseguradoSid: 100000000,
    deducibleConfig: { porcentaje: 2, cantidadSMMLV: 2, baseDeducible: 'valor_asegurable' },
  },
};
const resueltoAiu = resolverLiquidadorParaUpdate(sinAiuEnPayload, conAiu0);
assert(
  resueltoAiu?.liquidacionCotizacionPdf?.aiuPorcentaje === 0,
  'AIU 0 debe preservarse cuando el entrante lo omite'
);

const sinBloqueCotiz = {
  ...conAiu0,
  liquidacionCotizacionPdf: undefined,
};
const resueltoSinBloque = resolverLiquidadorParaUpdate(sinBloqueCotiz, conAiu0);
assert(
  resueltoSinBloque?.liquidacionCotizacionPdf?.aiuPorcentaje === 0,
  'AIU 0 debe restaurarse si falta todo liquidacionCotizacionPdf'
);
assert(
  Number(resueltoSinBloque?.liquidacionCotizacionPdf?.valorAseguradoSid) === 100000000,
  'SID de cotización debe restaurarse si falta el bloque'
);

console.log('OK protegerPresupuestoNsr10');
