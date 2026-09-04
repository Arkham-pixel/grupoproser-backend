/**
 * Backfill de campos de control de liquidación Alfa (derivados del liquidador).
 *
 * Actualiza en Mongo (colección de SegurosAlfaCaso):
 * - liquidadoCoberturaTerremo
 * - deducibleTerremoto
 * - valorLiquidacionCoberturasAdicionales
 * - deducibleCoberturasAdicionales
 * - valorTotalPagar
 * - reserva (solo si estaba vacío/0, salvo que se use --force-reserva)
 *
 * Reutiliza la lógica existente:
 * - extraerMontosLiquidadorAlfa() (utils/valoresLiquidadorAlfa.js)
 *
 * Ejemplos:
 *   node scripts/migrarAlfaCamposControlLiquidacion.js --dry-run
 *   node scripts/migrarAlfaCamposControlLiquidacion.js --dry-run --limit 200
 *   node scripts/migrarAlfaCamposControlLiquidacion.js --apply
 *   node scripts/migrarAlfaCamposControlLiquidacion.js --apply --force-reserva
 */

import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  extraerMontosLiquidadorAlfa,
  liquidadorAlfaTieneCifras,
} from '../utils/valoresLiquidadorAlfa.js';

const APPLY = process.argv.includes('--apply');
const DRY = process.argv.includes('--dry-run') || !APPLY;
const FORCE_RESERVA = process.argv.includes('--force-reserva');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  if (idx < 0) return null;
  const raw = String(process.argv[idx + 1] || '').trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
})();

function toEntero(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function reservaDebeActualizarse(caso, valorTotalPagar) {
  const r = caso?.reserva == null ? null : Number(caso.reserva);
  if (FORCE_RESERVA) return true;
  if (r == null) return true;
  if (!Number.isFinite(r)) return true;
  if (r === 0 && Number(valorTotalPagar) > 0) return true;
  // Si la reserva se había copiado del total a pagar (migración previa), mantenerlas alineadas.
  const totalGuardado = caso?.valorTotalPagar == null ? null : Number(caso.valorTotalPagar);
  if (Number.isFinite(totalGuardado) && r === totalGuardado && r !== Number(valorTotalPagar)) {
    return true;
  }
  // También si reserva = valorLiquidado antiguo (misma copia histórica).
  const liqGuardado = caso?.valorLiquidado == null ? null : Number(caso.valorLiquidado);
  if (Number.isFinite(liqGuardado) && r === liqGuardado && r !== Number(valorTotalPagar)) {
    return true;
  }
  return false;
}

await mongoose.connect(process.env.MONGO_URI);

const query = {
  liquidador: { $exists: true, $ne: null, $type: 'object' },
};

const casosCursor = SegurosAlfaCaso.find(query)
  .select(
    '_id consecutivo identificacion valorAseguradoSid tomador reserva valorLiquidado liquidadoCoberturaTerremo deducibleTerremoto valorLiquidacionCoberturasAdicionales deducibleCoberturasAdicionales valorTotalPagar liquidador'
  )
  .lean();

const casos = LIMIT ? (await casosCursor.limit(LIMIT).exec()) : await casosCursor.exec();

const samples = [];
let patched = 0;
let skipped = 0;

for (const caso of casos) {
  if (!liquidadorAlfaTieneCifras(caso.liquidador)) {
    skipped += 1;
    continue;
  }

  const montos = extraerMontosLiquidadorAlfa(caso.liquidador, caso) || {};

  const next = {
    liquidadoCoberturaTerremo: toEntero(montos.liquidadoCoberturaTerremo),
    deducibleTerremoto: toEntero(montos.deducibleTerremoto),
    valorLiquidacionCoberturasAdicionales: toEntero(montos.valorLiquidacionCoberturasAdicionales),
    deducibleCoberturasAdicionales: toEntero(montos.deducibleCoberturasAdicionales ?? 0),
    valorTotalPagar: toEntero(montos.valorTotalPagar),
    // El liquidador es la fuente: valorLiquidado = total a pagar.
    valorLiquidado: toEntero(montos.valorTotalPagar),
  };

  if (reservaDebeActualizarse(caso, next.valorTotalPagar)) {
    next.reserva = next.valorTotalPagar;
  }

  const patch = {};
  const campos = Object.keys(next);
  for (const f of campos) {
    const antes = caso?.[f];
    const b = Number(next[f] ?? 0);
    if (!Number.isFinite(b)) continue;
    if (antes == null || antes === '') {
      patch[f] = next[f];
      continue;
    }
    const a = Number(antes);
    if (!Number.isFinite(a) || a !== b) patch[f] = next[f];
  }

  if (!Object.keys(patch).length) {
    skipped += 1;
    continue;
  }

  patched += 1;
  if (samples.length < 20) {
    samples.push({
      consecutivo: caso.consecutivo,
      identificacion: caso.identificacion,
      before: {
        reserva: caso.reserva,
        valorLiquidado: caso.valorLiquidado,
        liquidadoCoberturaTerremo: caso.liquidadoCoberturaTerremo,
        deducibleTerremoto: caso.deducibleTerremoto,
        valorLiquidacionCoberturasAdicionales: caso.valorLiquidacionCoberturasAdicionales,
        deducibleCoberturasAdicionales: caso.deducibleCoberturasAdicionales,
        valorTotalPagar: caso.valorTotalPagar,
      },
      patch,
    });
  }

  if (DRY) continue;

  await SegurosAlfaCaso.updateOne({ _id: caso._id }, { $set: patch });
}

console.log(
  JSON.stringify(
    {
      dry: DRY,
      apply: APPLY,
      casos: casos.length,
      patched,
      skipped,
      samples,
    },
    null,
    2
  )
);

await mongoose.disconnect();

