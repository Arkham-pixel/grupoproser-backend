/**
 * Remapea responsable en casos Express: texto/variantes → codiRespnsble del catálogo.
 *
 * Uso (desde /backend):
 *   node scripts/remapearResponsablesExpress.js --dry-run
 *   node scripts/remapearResponsablesExpress.js
 */

import dns from 'dns';
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import Responsable from '../models/Responsable.js';
import SiniestroExpress from '../models/SiniestroExpress.js';
import {
  buildResponsableResolverIndex,
  resolverResponsableConIndice,
} from '../services/responsableResolverService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const dryRun = process.argv.includes('--dry-run');

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 30000,
});

const responsables = await Responsable.find().lean();
const index = buildResponsableResolverIndex(responsables);
const codigos = new Set(responsables.map((r) => String(r.codiRespnsble)));

const valores = await SiniestroExpress.distinct('responsable');
let actualizados = 0;
const cambios = [];

for (const valor of valores) {
  if (!valor) continue;
  const raw = String(valor).trim();
  if (codigos.has(raw)) continue;

  const codi = resolverResponsableConIndice(raw, index);
  if (!codi || codi === raw) continue;

  const count = await SiniestroExpress.countDocuments({ responsable: valor });
  cambios.push({ de: raw, a: codi, count });
  actualizados += count;

  if (!dryRun) {
    await SiniestroExpress.updateMany({ responsable: valor }, { $set: { responsable: codi } });
  }
}

console.log(dryRun ? 'DRY RUN — sin cambios en BD' : 'Remapeo aplicado');
console.log(`Casos afectados: ${actualizados}`);
for (const c of cambios) {
  console.log(`  ${c.de} → ${c.a} (${c.count})`);
}

await mongoose.disconnect();
