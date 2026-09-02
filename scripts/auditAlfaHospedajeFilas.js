/**
 * Cuenta filas fantasma de hospedaje (1% SID) vs ítems reales mal etiquetados.
 * node scripts/auditAlfaHospedajeFilas.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { parseCopMoney } from '../utils/alfaExcelNormalize.js';

await mongoose.connect(process.env.MONGO_URI);

function n(v) {
  return parseCopMoney(v) || 0;
}
function texto(it = {}) {
  return String(it?.actividad || it?.descripcion || it?.componente || it?.concepto || '').trim();
}
function esDescHosp(t) {
  const s = String(t || '').toLowerCase();
  return !s || s.includes('hospedaje') || s.includes('alojamiento temporal');
}
function monto(it) {
  return n(it.valorPerdida) || n(it.total) || n(it.cantidad) * n(it.valorUnitario);
}

const casos = await SegurosAlfaCaso.find({
  liquidador: { $exists: true, $type: 'object' },
})
  .select('consecutivo asegurado valorAseguradoSid valorReclamado valorLiquidado liquidador')
  .lean();

const fantasmaSolo = [];
const fantasmaConItems = [];
const idHospPeroItemReal = [];

for (const c of casos) {
  const liq = c.liquidador || {};
  const sid = n(c.valorAseguradoSid) || n(liq.encabezado?.valorAseguradoSid);
  const auto1 = sid ? Math.round(sid * 0.01) : 0;
  const auto2 = sid ? Math.round(sid * 0.02) : 0;
  const hospManual = n(liq.liquidacionCatastrofico?.hospedajeManual);
  const det = Array.isArray(liq.detalleLiquidacionCat) ? liq.detalleLiquidacionCat : [];
  const pres = Array.isArray(liq.evaluacionSismicaNSR10?.presupuesto?.items)
    ? liq.evaluacionSismicaNSR10.presupuesto.items
    : [];
  const rows = det.length ? det : pres;

  const phantoms = [];
  const reales = [];
  const malId = [];
  for (const it of rows) {
    const t = texto(it);
    const id = String(it?.id || '');
    const m = Math.round(monto(it));
    const pareceAuto =
      hospManual === 0 &&
      (id === 'hospedaje' || esDescHosp(t)) &&
      esDescHosp(t) &&
      m > 0 &&
      ((auto1 > 0 && Math.abs(m - auto1) / auto1 < 0.03) ||
        (auto2 > 0 && Math.abs(m - auto2) / auto2 < 0.03));
    const esRealConIdHosp = id === 'hospedaje' && t && !esDescHosp(t);
    if (pareceAuto) phantoms.push({ t: t || '(vacío)', m, id });
    else if (esRealConIdHosp) malId.push({ t, m, id });
    else if (t || m) reales.push({ t, m, id });
  }

  const row = {
    consecutivo: c.consecutivo,
    asegurado: c.asegurado,
    sid,
    phantoms,
    malId,
    nReales: reales.length,
    valorReclamado: c.valorReclamado,
    valorLiquidado: c.valorLiquidado,
  };
  if (phantoms.length && !reales.length && !malId.length) fantasmaSolo.push(row);
  else if (phantoms.length && (reales.length || malId.length)) fantasmaConItems.push(row);
  if (malId.length) idHospPeroItemReal.push(row);
}

console.log(
  JSON.stringify(
    {
      fantasmaSolo: fantasmaSolo.length,
      fantasmaConItems: fantasmaConItems.length,
      idHospPeroItemReal: idHospPeroItemReal.length,
      listaFantasmaSolo: fantasmaSolo,
      listaFantasmaConItems: fantasmaConItems.map((r) => ({
        consecutivo: r.consecutivo,
        nReales: r.nReales,
        phantoms: r.phantoms,
      })),
      listaMalId: idHospPeroItemReal.map((r) => ({
        consecutivo: r.consecutivo,
        malId: r.malId,
        nReales: r.nReales,
        phantoms: r.phantoms,
      })),
    },
    null,
    2
  )
);

await mongoose.disconnect();
