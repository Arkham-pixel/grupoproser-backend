/**
 * Corrige codiEstdo inválidos en casos de riesgo.
 * El catálogo de riesgos solo usa 1-4; códigos de siniestros (p. ej. 13 = CASO NUEVO) no aplican.
 *
 * Uso:
 *   node scripts/corregirEstadosRiesgoInvalidos.js --dry-run
 *   node scripts/corregirEstadosRiesgoInvalidos.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import Riesgo from '../models/CasoRiesgo.js';
import EstadoRiesgo from '../models/EstadoRiesgo.js';

const MONGO_URI = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
const dryRun = process.argv.includes('--dry-run');

/** Códigos del catálogo general de siniestros → código válido de riesgos */
const MAPEO_LEGACY = {
  13: 1, // CASO NUEVO → Asignado
};

async function main() {
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI no definido');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  console.log(`🔌 Conectado${dryRun ? ' (dry-run)' : ''}`);

  const estadosValidos = await EstadoRiesgo.find().lean();
  const codigosValidos = new Set(
    estadosValidos.map((e) => Number(e.codiEstdo)).filter((n) => Number.isFinite(n))
  );
  console.log('✅ Estados de riesgo válidos:', [...codigosValidos].sort((a, b) => a - b).join(', '));

  const casos = await Riesgo.find({ codiEstdo: { $exists: true, $ne: null } }).lean();
  const invalidos = casos.filter((c) => !codigosValidos.has(Number(c.codiEstdo)));

  if (invalidos.length === 0) {
    console.log('✅ No hay casos con estados inválidos.');
    await mongoose.disconnect();
    return;
  }

  console.log(`⚠️ Casos con estado inválido: ${invalidos.length}`);
  for (const caso of invalidos) {
    const codigoActual = Number(caso.codiEstdo);
    const codigoNuevo = MAPEO_LEGACY[codigoActual] ?? 1;
    const estadoNombre =
      estadosValidos.find((e) => Number(e.codiEstdo) === codigoNuevo)?.descEstdo ?? codigoNuevo;
    console.log(
      `  - ${caso.nmroRiesgo || caso._id}: ${codigoActual} → ${codigoNuevo} (${estadoNombre})`
    );

    if (!dryRun) {
      await Riesgo.updateOne({ _id: caso._id }, { $set: { codiEstdo: codigoNuevo } });
    }
  }

  if (dryRun) {
    console.log('\nℹ️ Dry-run: no se aplicaron cambios. Ejecuta sin --dry-run para corregir.');
  } else {
    console.log(`\n✅ ${invalidos.length} caso(s) corregido(s).`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌', err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
