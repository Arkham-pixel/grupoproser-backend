/**
 * Remapea responsable, aseguradora y estado en casos Express.
 *
 * Uso (desde /backend):
 *   node scripts/remapearCatalogosExpress.js --dry-run
 *   node scripts/remapearCatalogosExpress.js
 */

import dns from 'dns';
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import Responsable from '../models/Responsable.js';
import Cliente from '../models/Cliente.js';
import EstadoExpress from '../models/EstadoExpress.js';
import SiniestroExpress from '../models/SiniestroExpress.js';
import {
  buildResponsableResolverIndex,
  resolverResponsableConIndice,
} from '../services/responsableResolverService.js';
import {
  buildClienteResolverIndex,
  resolverClienteConIndice,
} from '../services/clienteResolverService.js';
import {
  buildEstadoExpressResolverIndex,
  resolverEstadoExpressConIndice,
} from '../services/estadoExpressResolverService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const dryRun = process.argv.includes('--dry-run');

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 30000,
});

const [responsables, clientes, estados] = await Promise.all([
  Responsable.find().lean(),
  Cliente.find().lean(),
  EstadoExpress.find().lean(),
]);
const responsableIndex = buildResponsableResolverIndex(responsables);
const clienteIndex = buildClienteResolverIndex(clientes);
const estadoIndex = buildEstadoExpressResolverIndex(estados);
const codigosResponsable = new Set(responsables.map((r) => String(r.codiRespnsble)));
const codigosCliente = new Set(clientes.map((c) => String(c.codiAsgrdra)));
const codigosEstado = new Set(
  estados.map((e) => String(e.codiEstdo ?? e.codiEstado)).filter(Boolean)
);

const remapearCampo = async (campo, index, codigosCatalogo, resolver) => {
  const valores = await SiniestroExpress.distinct(campo);
  let actualizados = 0;
  const cambios = [];

  for (const valor of valores) {
    if (!valor) continue;
    const raw = String(valor).trim();
    if (codigosCatalogo.has(raw)) continue;

    const codi = resolver(raw, index);
    if (!codi || codi === raw) continue;

    const count = await SiniestroExpress.countDocuments({ [campo]: valor });
    cambios.push({ de: raw, a: codi, count });
    actualizados += count;

    if (!dryRun) {
      await SiniestroExpress.updateMany({ [campo]: valor }, { $set: { [campo]: codi } });
    }
  }

  return { actualizados, cambios };
};

const responsable = await remapearCampo(
  'responsable',
  responsableIndex,
  codigosResponsable,
  resolverResponsableConIndice
);
const aseguradora = await remapearCampo(
  'aseguradora',
  clienteIndex,
  codigosCliente,
  resolverClienteConIndice
);
const estado = await remapearCampo(
  'estadoProceso',
  estadoIndex,
  codigosEstado,
  resolverEstadoExpressConIndice
);

console.log(dryRun ? 'DRY RUN — sin cambios en BD' : 'Remapeo aplicado');
console.log(`Responsable: ${responsable.actualizados} casos`);
for (const c of responsable.cambios) console.log(`  ${c.de} → ${c.a} (${c.count})`);
console.log(`Aseguradora: ${aseguradora.actualizados} casos`);
for (const c of aseguradora.cambios) console.log(`  ${c.de} → ${c.a} (${c.count})`);
console.log(`Estado: ${estado.actualizados} casos`);
for (const c of estado.cambios) console.log(`  ${c.de} → ${c.a} (${c.count})`);

await mongoose.disconnect();
