/**
 * Regresión: liquidador manda sobre montos planos (AIU 0, sin ×1.2 fantasma).
 * node scripts/testAlfaMontosLiquidadorManda.js
 */
import {
  aplicarMontosOficialesDesdeLiquidadorAlfa,
  extraerMontosLiquidadorAlfa,
} from '../utils/valoresLiquidadorAlfa.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const liquidadorAiu0 = {
  cotizacionesPdf: {
    completo: {
      montoFinal: 5_000_000,
      usarComoBasePresupuesto: true,
      paginas: [{ ruta: '/x.pdf' }],
    },
  },
  liquidacionCotizacionPdf: {
    aiuPorcentaje: 0,
    valorAseguradoSid: 100_000_000,
    deducibleConfig: {
      porcentaje: 2,
      cantidadSMMLV: 0,
      baseDeducible: 'valor_asegurable',
      valorSMMLV: 1_750_905,
    },
  },
};

const montos = extraerMontosLiquidadorAlfa(liquidadorAiu0, {
  valorAseguradoSid: 200_000_000, // SID ×2 fantasma en el plano
});
assert(montos.aiuPct === 0, `aiuPct debe ser 0, got ${montos.aiuPct}`);
assert(montos.valorReclamado === 5_000_000, `reclamado sin AIU: got ${montos.valorReclamado}`);
assert(montos.sid === 100_000_000, `SID cotiz, no ×2: got ${montos.sid}`);
// Deducible 2% de 100M = 2M → liquidado = 5M - 2M = 3M
assert(montos.valorLiquidado === 3_000_000, `liquidado: got ${montos.valorLiquidado}`);

const docSucio = {
  liquidador: liquidadorAiu0,
  valorReclamado: 6_000_000, // ×1.2 fantasma
  valorLiquidado: 4_000_000,
  reserva: 4_000_000,
  valorAseguradoSid: 200_000_000,
};
const limpio = aplicarMontosOficialesDesdeLiquidadorAlfa(docSucio);
assert(limpio.valorReclamado === 5_000_000, 'heal reclamado AIU0');
assert(limpio.valorLiquidado === 3_000_000, 'heal liquidado');
assert(limpio.reserva === 3_000_000, 'heal reserva');
assert(limpio.valorAseguradoSid === 100_000_000, 'heal SID desde cotiz');

// Sin liquidacionCotizacionPdf.aiuPorcentaje → default 20% (comportamiento histórico).
const sinAiu = {
  cotizacionesPdf: liquidadorAiu0.cotizacionesPdf,
  liquidacionCotizacionPdf: {
    valorAseguradoSid: 100_000_000,
    deducibleConfig: liquidadorAiu0.liquidacionCotizacionPdf.deducibleConfig,
  },
};
const montosDefault = extraerMontosLiquidadorAlfa(sinAiu, {});
assert(
  Math.abs(montosDefault.aiuPct - 0.2) < 1e-9,
  `sin aiu explícito → 20%: got ${montosDefault.aiuPct}`
);
assert(montosDefault.valorReclamado === 6_000_000, 'reclamado con AIU 20%');

console.log('OK testAlfaMontosLiquidadorManda');
