/**
 * Copia valores BBVA (reserva/inmueble/reclamado) y liquidado Proser del CAT al listado (solo huecos).
 * No pisa bloques, archivos, estado ni montos ya diligenciados.
 * No usar para copiar cuantía probable: esa columna no es reserva.
 *
 * Uso: node scripts/espejarValoresCatEnListadoBbva.js
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import mongoose from 'mongoose';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';

const esHueco = (valor) => {
  if (valor == null || valor === '') return true;
  const n = Number(valor);
  return !Number.isFinite(n) || n <= 0;
};

const llenarSiHueco = (doc, campo, monto, cambios) => {
  if (!(monto > 0) || !esHueco(doc[campo])) return;
  doc[campo] = monto;
  cambios[campo] = monto;
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);
  const cats = await BbvaCatCaso.find({}).select(
    'zc siniestro reserva valorAseguradoInmueble valorReclamado valorLiquidado valorALiquidar'
  );
  const listado = await BbvaCatListadoCaso.find({}).select(
    'zc siniestro reserva valorAseguradoInmueble valorReclamado valorLiquidado valorALiquidar'
  );

  const porClave = new Map();
  for (const c of cats) {
    const valores = {
      reserva: Number(c.reserva) || 0,
      valorAseguradoInmueble: Number(c.valorAseguradoInmueble) || 0,
      valorReclamado: Number(c.valorReclamado) || 0,
      valorLiquidado: Number(c.valorLiquidado) || 0,
      valorALiquidar: Number(c.valorALiquidar) || 0,
    };
    for (const k of [c.zc, c.siniestro]) {
      const t = String(k || '').trim();
      if (t) porClave.set(t, valores);
    }
  }

  const resumen = {
    listado: listado.length,
    actualizados: 0,
    sinMatch: 0,
    sinValoresNuevos: 0,
    campos: {
      reserva: 0,
      valorAseguradoInmueble: 0,
      valorReclamado: 0,
      valorLiquidado: 0,
      valorALiquidar: 0,
    },
  };

  for (const caso of listado) {
    const valores =
      porClave.get(String(caso.zc || '').trim()) ||
      porClave.get(String(caso.siniestro || '').trim());
    if (!valores) {
      resumen.sinMatch += 1;
      continue;
    }
    const cambios = {};
    llenarSiHueco(caso, 'reserva', valores.reserva, cambios);
    llenarSiHueco(caso, 'valorAseguradoInmueble', valores.valorAseguradoInmueble, cambios);
    llenarSiHueco(caso, 'valorReclamado', valores.valorReclamado, cambios);
    llenarSiHueco(caso, 'valorLiquidado', valores.valorLiquidado, cambios);
    llenarSiHueco(caso, 'valorALiquidar', valores.valorALiquidar, cambios);
    const keys = Object.keys(cambios);
    if (!keys.length) {
      resumen.sinValoresNuevos += 1;
      continue;
    }
    await caso.save();
    resumen.actualizados += 1;
    for (const k of keys) resumen.campos[k] += 1;
  }

  const conReserva = await BbvaCatListadoCaso.countDocuments({ reserva: { $gt: 0 } });
  console.log(
    JSON.stringify(
      {
        ...resumen,
        despues: { conReserva, total: await BbvaCatListadoCaso.countDocuments() },
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
