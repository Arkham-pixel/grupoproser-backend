/**
 * Detalle de liquidadores Alfa sospechosos (solo hospedaje / vacíos con SID).
 * node scripts/inspectAlfaHospedajeCasos.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { parseCopMoney } from '../utils/alfaExcelNormalize.js';

await mongoose.connect(process.env.MONGO_URI);

const ids = [
  'ALFA-2026-08-137',
  'ALFA-2026-08-855',
  'ALFA-2026-08-904',
  'ALFA-2026-08-1357',
  'ALFA-2026-08-1387',
  'ALFA-2026-08-1865',
];

function n(v) {
  return parseCopMoney(v) || 0;
}
function texto(it = {}) {
  return String(it?.actividad || it?.descripcion || it?.componente || it?.concepto || '').trim();
}

function slimItem(it) {
  return {
    id: it.id,
    desc: texto(it),
    cant: it.cantidad,
    vu: it.valorUnitario,
    total: it.total ?? it.valorPerdida,
  };
}

const casos = await SegurosAlfaCaso.find({ consecutivo: { $in: ids } })
  .select(
    'consecutivo asegurado valorAseguradoSid valorReclamado valorLiquidado liquidador.detalleLiquidacionCat liquidador.evaluacionSismicaNSR10.presupuesto liquidador.liquidacionCatastrofico liquidador.otrosAmparos liquidador.encabezado.valorAseguradoSid liquidador.cotizacionesPdf'
  )
  .lean();

const out = casos.map((c) => {
  const liq = c.liquidador || {};
  const cat = liq.liquidacionCatastrofico || {};
  const sid = n(c.valorAseguradoSid) || n(liq.encabezado?.valorAseguradoSid);
  return {
    consecutivo: c.consecutivo,
    asegurado: c.asegurado,
    sid,
    auto1pct: Math.round(sid * 0.01),
    valorReclamado: c.valorReclamado,
    valorLiquidado: c.valorLiquidado,
    hospPct: cat.hospedajePorcentaje,
    hospManual: cat.hospedajeManual,
    detalle: (liq.detalleLiquidacionCat || []).map(slimItem),
    presupuesto: (liq.evaluacionSismicaNSR10?.presupuesto?.items || []).map(slimItem),
    aiuPct: liq.evaluacionSismicaNSR10?.presupuesto?.aiuPorcentaje,
    otrosAmparos: (liq.otrosAmparos || [])
      .filter((a) => a && a.aplica !== false)
      .map((a) => ({ id: a.id, nombre: a.nombre || a.descripcion, valor: a.valor, aplica: a.aplica })),
  };
});

const vaciosConSid = await SegurosAlfaCaso.find({
  liquidador: { $exists: true, $type: 'object' },
  valorAseguradoSid: { $gt: 0 },
})
  .select('consecutivo valorAseguradoSid liquidador.detalleLiquidacionCat liquidador.evaluacionSismicaNSR10.presupuesto.items liquidador.liquidacionCatastrofico.hospedajeManual')
  .lean();

function tieneItems(c) {
  const det = c.liquidador?.detalleLiquidacionCat;
  const pres = c.liquidador?.evaluacionSismicaNSR10?.presupuesto?.items;
  const t = (it) =>
    String(it?.actividad || it?.descripcion || it?.componente || it?.concepto || '').trim();
  const nDet = Array.isArray(det) ? det.filter((it) => t(it)).length : 0;
  const nPres = Array.isArray(pres) ? pres.filter((it) => t(it)).length : 0;
  return nDet + nPres > 0;
}

const vaciosSid = vaciosConSid.filter((c) => !tieneItems(c)).map((c) => ({
  consecutivo: c.consecutivo,
  sid: c.valorAseguradoSid,
  autoHospUi: Math.round(Number(c.valorAseguradoSid) * 0.01),
  hospManual: c.liquidador?.liquidacionCatastrofico?.hospedajeManual ?? '',
  detalleEsArray: Array.isArray(c.liquidador?.detalleLiquidacionCat),
  nDetalle: Array.isArray(c.liquidador?.detalleLiquidacionCat)
    ? c.liquidador.detalleLiquidacionCat.length
    : null,
}));

console.log(
  JSON.stringify(
    {
      sospechosos: out,
      vaciosConSidQueMostrarianHospAuto: vaciosSid.length,
      muestraVacios: vaciosSid.slice(0, 15),
    },
    null,
    2
  )
);

await mongoose.disconnect();
