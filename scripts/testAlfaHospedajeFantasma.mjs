/**
 * Hospedaje Alfa: no inyectar 1% SID; no tratar ítem de catálogo como hospedaje.
 * node scripts/testAlfaHospedajeFantasma.mjs
 */
import {
  extraerMontosLiquidadorAlfa,
  esFilaHospedajeAlfa,
  esFilaHospedajeFantasmaAlfa,
  limpiarLiquidadorHospedajeFantasmaAlfa,
} from '../utils/valoresLiquidadorAlfa.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(
  !esFilaHospedajeAlfa({
    id: 'hospedaje',
    descripcion: 'DEMOLICION ESTUCO Y PINTURA MUROS',
  }),
  'demolición con id hospedaje no es hospedaje'
);
assert(
  esFilaHospedajeAlfa({
    id: 'hospedaje',
    descripcion: 'Gastos de hospedaje / alojamiento temporal',
  }),
  'texto de hospedaje sí cuenta'
);
assert(
  esFilaHospedajeAlfa({ id: 'hospedaje', descripcion: '' }),
  'id hospedaje vacío sí cuenta'
);

const sid = 125_000_000;
assert(
  esFilaHospedajeFantasmaAlfa(
    {
      id: 'hospedaje',
      descripcion: 'Gastos de hospedaje / alojamiento temporal',
      valorPerdida: 1_250_000,
    },
    { sid, hospedajeManual: '' }
  ),
  '1% SID es fantasma'
);
assert(
  esFilaHospedajeFantasmaAlfa(
    {
      id: 'hospedaje',
      capitulo: 'Otros',
      descripcion: 'Gastos de hospedaje / alojamiento temporal',
      valorPerdida: '3.359.650',
    },
    { sid: 335_965_000, hospedajeManual: '' }
  ),
  'capítulo Otros no oculta hospedaje fantasma'
);
assert(
  !esFilaHospedajeFantasmaAlfa(
    {
      id: 'hospedaje',
      descripcion: 'CERAMICA 60-70 CM X60-70 CM TRAF 3-4',
      valorPerdida: 2_841_212,
    },
    { sid: 91_556_591, hospedajeManual: '' }
  ),
  'cerámica no es fantasma'
);

const sucio = {
  encabezado: { valorAseguradoSid: sid },
  liquidacionCatastrofico: { hospedajeManual: '' },
  detalleLiquidacionCat: [
    {
      id: 'hospedaje',
      descripcion: 'Gastos de hospedaje / alojamiento temporal',
      valorPerdida: 1_250_000,
    },
  ],
  evaluacionSismicaNSR10: { presupuesto: { items: [], aiuPorcentaje: 0.2 } },
};
const limpio = limpiarLiquidadorHospedajeFantasmaAlfa(sucio, { valorAseguradoSid: sid });
assert(limpio.stripped === 1, `stripped ${limpio.stripped}`);
assert((limpio.liquidador.detalleLiquidacionCat || []).length === 0, 'detalle vacío');
const montos = extraerMontosLiquidadorAlfa(limpio.liquidador, { valorAseguradoSid: sid });
assert(montos.valorReclamado === 0, `reclamado ${montos.valorReclamado}`);

const malId = limpiarLiquidadorHospedajeFantasmaAlfa(
  {
    detalleLiquidacionCat: [
      {
        id: 'hospedaje',
        descripcion: 'DEMOLICION ESTUCO Y PINTURA MUROS',
        valorPerdida: 490_050,
      },
    ],
  },
  { valorAseguradoSid: 130_145_794 }
);
assert(malId.retagged === 1, 'retag demolición');
assert(malId.liquidador.detalleLiquidacionCat[0].id !== 'hospedaje', 'nuevo id');
assert(malId.stripped === 0, 'no borrar demolición');

console.log('OK testAlfaHospedajeFantasma');
