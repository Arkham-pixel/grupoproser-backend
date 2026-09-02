/**
 * Sube valorALiquidar desde el liquidador a listado y CAT.
 * No toca reserva BBVA ni reserva del ajustador (valorLiquidado).
 * El AIU 25% queda en el liquidador de cada caso, con sus cifras reales.
 *
 * Uso: node scripts/subirValorLiquidadoDesdeLiquidadorBbva.js
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import mongoose from 'mongoose';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';
import {
  extraerValorLiquidadoLiquidadorBbva,
  liquidadorBbvaCatTieneCifras,
} from '../utils/valoresLiquidadorBbvaCat.js';

const hueco = (valor) => {
  if (valor == null || valor === '') return true;
  const n = Number(valor);
  return !Number.isFinite(n);
};

async function aplicarEnColeccion(Model, etiqueta) {
  const docs = await Model.find({ liquidador: { $type: 'object' } }).select(
    'consecutivo zc siniestro asegurado reserva valorLiquidado valorALiquidar liquidador'
  );
  const resumen = {
    coleccion: etiqueta,
    revisados: docs.length,
    actualizados: 0,
    sinCifras: 0,
    sumaValorALiquidar: 0,
    detalle: [],
  };
  for (const doc of docs) {
    if (!liquidadorBbvaCatTieneCifras(doc.liquidador)) {
      resumen.sinCifras += 1;
      continue;
    }
    const monto = extraerValorLiquidadoLiquidadorBbva(doc.liquidador);
    const previo = Number(doc.valorALiquidar);
    if (!hueco(doc.valorALiquidar) && previo === monto) {
      if (monto > 0) resumen.sumaValorALiquidar += monto;
      continue;
    }
    doc.valorALiquidar = monto;
    await doc.save();
    resumen.actualizados += 1;
    if (monto > 0) resumen.sumaValorALiquidar += monto;
    resumen.detalle.push({
      consecutivo: doc.consecutivo,
      zc: doc.zc || doc.siniestro,
      asegurado: doc.asegurado,
      reservaBbva: Number(doc.reserva) || 0,
      reservaAjustador: Number(doc.valorLiquidado) || 0,
      previo: hueco(doc.valorALiquidar) ? null : previo,
      valorALiquidar: monto,
    });
  }
  return resumen;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 20000,
  });
  const listado = await aplicarEnColeccion(BbvaCatListadoCaso, 'listado');
  const cat = await aplicarEnColeccion(BbvaCatCaso, 'cat');
  console.log(JSON.stringify({ listado, cat }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
