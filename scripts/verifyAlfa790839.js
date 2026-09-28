/**
 * Spot-check 790 / 839: planos vs liquidador.
 * node scripts/verifyAlfa790839.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  extraerMontosLiquidadorAlfa,
  liquidadorAlfaTieneCifras,
} from '../utils/valoresLiquidadorAlfa.js';

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
});

const ids = ['ALFA-2026-08-790', 'ALFA-2026-08-839'];
for (const c of ids) {
  const caso = await SegurosAlfaCaso.findOne({ consecutivo: c }).lean();
  if (!caso) {
    console.log(JSON.stringify({ c, status: 'MISSING' }));
    continue;
  }
  const has = liquidadorAlfaTieneCifras(caso.liquidador);
  const m = has ? extraerMontosLiquidadorAlfa(caso.liquidador, caso) : null;
  const rec = Math.round(Number(caso.valorReclamado) || 0);
  const liq = Math.round(Number(caso.valorLiquidado) || 0);
  const recOk = m ? Math.round(m.valorReclamado) : null;
  const liqOk = m ? Math.round(m.valorLiquidado) : null;
  const ok = !m || (rec === recOk && liq === liqOk);
  console.log(
    JSON.stringify({
      c,
      ok,
      rec,
      liq,
      recOk,
      liqOk,
      aiu: m?.aiuPct ?? null,
      sid: m?.sid ?? null,
      sidCaso: caso.valorAseguradoSid ?? null,
      aiuCotiz: caso.liquidador?.liquidacionCotizacionPdf?.aiuPorcentaje ?? null,
    })
  );
}

await mongoose.disconnect();
