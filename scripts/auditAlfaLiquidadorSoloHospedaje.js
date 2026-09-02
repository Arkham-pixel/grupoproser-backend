/**
 * Audita liquidadores Alfa: detalle/presupuesto solo con hospedaje.
 * node scripts/auditAlfaLiquidadorSoloHospedaje.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { extraerMontosLiquidadorAlfa } from '../utils/valoresLiquidadorAlfa.js';
import { parseCopMoney } from '../utils/alfaExcelNormalize.js';

await mongoose.connect(process.env.MONGO_URI);

function texto(it = {}) {
  return String(
    it?.actividad || it?.concepto || it?.descripcion || it?.componente || it?.item || ''
  ).trim();
}

function esHospedaje(it = {}) {
  const id = String(it?.id || '').toLowerCase();
  const t = texto(it).toLowerCase();
  return id === 'hospedaje' || t.includes('hospedaje') || t.includes('alojamiento temporal');
}

function n(v) {
  return parseCopMoney(v) || 0;
}

function montoFila(it = {}) {
  return (
    n(it.valorPerdida) ||
    n(it.total) ||
    n(it.valorReal) ||
    n(it.cantidad) * n(it.valorUnitario)
  );
}

function clasificar(items) {
  const list = Array.isArray(items) ? items.filter((it) => texto(it) || montoFila(it)) : [];
  const hosp = list.filter(esHospedaje);
  const otros = list.filter((it) => !esHospedaje(it));
  return {
    n: list.length,
    nHosp: hosp.length,
    nOtros: otros.length,
    montoHosp: Math.round(hosp.reduce((a, it) => a + montoFila(it), 0)),
    montoOtros: Math.round(otros.reduce((a, it) => a + montoFila(it), 0)),
    descHosp: hosp.map((it) => texto(it)).slice(0, 3),
    descOtros: otros.map((it) => texto(it)).slice(0, 5),
  };
}

const casos = await SegurosAlfaCaso.find({
  liquidador: { $exists: true, $ne: null, $type: 'object' },
})
  .select(
    'consecutivo asegurado ajustador valorAseguradoSid valorReclamado valorLiquidado liquidador'
  )
  .lean();

const buckets = {
  soloHospedaje: [],
  hospMasItems: [],
  itemsSinHosp: [],
  vacio: [],
  cotizacion: [],
};
const recuperables = [];

for (const c of casos) {
  const liq = c.liquidador || {};
  const det = clasificar(liq.detalleLiquidacionCat);
  const pres = clasificar(liq.evaluacionSismicaNSR10?.presupuesto?.items);
  const cotizSlots = [
    liq.cotizacionesPdf?.materiales,
    liq.cotizacionesPdf?.manoObra,
    liq.cotizacionesPdf?.completo,
    liq.cotizacionPdf,
  ].filter((s) => s && typeof s === 'object' && n(s.montoFinal) > 0);
  const hospManual = n(liq.liquidacionCatastrofico?.hospedajeManual);
  const sid = n(c.valorAseguradoSid) || n(liq.encabezado?.valorAseguradoSid);
  const auto1pct = sid > 0 ? Math.round(sid * 0.01) : 0;
  const montos = extraerMontosLiquidadorAlfa(liq, c);

  const nOtros = det.nOtros + pres.nOtros;
  const nHosp = det.nHosp + pres.nHosp;
  const soloHosp =
    nOtros === 0 &&
    (nHosp > 0 || hospManual > 0) &&
    cotizSlots.length === 0;

  const row = {
    consecutivo: c.consecutivo,
    asegurado: c.asegurado,
    ajustador: c.ajustador,
    sid,
    det,
    pres,
    hospManual,
    auto1pct,
    hospCoincide1pct:
      det.montoHosp > 0 && auto1pct > 0 && Math.abs(det.montoHosp - auto1pct) / auto1pct < 0.02,
    cotiz: cotizSlots.length,
    valorReclamado: c.valorReclamado,
    valorLiquidado: c.valorLiquidado,
    liqReclamado: Math.round(montos.valorReclamado || 0),
    liqLiquidado: Math.round(montos.valorLiquidado || 0),
  };

  if (cotizSlots.length && nOtros === 0 && nHosp > 0) {
    buckets.cotizacion.push(row);
  } else if (soloHosp) {
    buckets.soloHospedaje.push(row);
  } else if (nOtros > 0 && nHosp > 0) {
    buckets.hospMasItems.push(row);
  } else if (nOtros > 0) {
    buckets.itemsSinHosp.push(row);
  } else {
    buckets.vacio.push(row);
  }

  if (pres.nOtros > 0 && det.n > 0 && det.nOtros === 0 && det.nHosp > 0) {
    recuperables.push(row);
  }
}

function mini(list) {
  return list.slice(0, 25).map((r) => ({
    consecutivo: r.consecutivo,
    asegurado: r.asegurado,
    detHosp: r.det.montoHosp,
    detOtros: r.det.nOtros,
    presOtros: r.pres.nOtros,
    presDesc: r.pres.descOtros,
    auto1pct: r.hospCoincide1pct,
    reclamado: r.valorReclamado,
    liquidado: r.valorLiquidado,
  }));
}

console.log(
  JSON.stringify(
    {
      totalConLiquidador: casos.length,
      conteos: {
        soloHospedaje: buckets.soloHospedaje.length,
        hospMasItems: buckets.hospMasItems.length,
        itemsSinHosp: buckets.itemsSinHosp.length,
        vacio: buckets.vacio.length,
        cotizacion: buckets.cotizacion.length,
        recuperablesPresupuestoIgnorado: recuperables.length,
      },
      soloHospedajeAuto1pct: buckets.soloHospedaje.filter((r) => r.hospCoincide1pct).length,
      soloHospedajeManual: buckets.soloHospedaje.filter((r) => !r.hospCoincide1pct).length,
      soloHospedaje: mini(buckets.soloHospedaje),
      recuperables: mini(recuperables),
      todosSoloHospedaje: buckets.soloHospedaje.map((r) => r.consecutivo),
    },
    null,
    2
  )
);

await mongoose.disconnect();
