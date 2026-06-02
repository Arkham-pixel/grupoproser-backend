/**
 * Verifica integridad de catálogos y fechas en casos Express.
 *
 * Uso (desde /backend):
 *   node scripts/verificarIntegridadExpress.js
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
import {
  buildCatalogMaps,
  normalizarConMapas,
} from '../services/expressCatalogoService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 30000,
});

const total = await SiniestroExpress.countDocuments();
console.log(`\n=== Verificación Express (${total} casos) ===\n`);

const [responsables, clientes, estados, expressMaps] = await Promise.all([
  Responsable.find().lean(),
  Cliente.find().lean(),
  EstadoExpress.find().lean(),
  buildCatalogMaps(),
]);

const rIdx = buildResponsableResolverIndex(responsables);
const cIdx = buildClienteResolverIndex(clientes);
const eIdx = buildEstadoExpressResolverIndex(estados);
const codigosResponsable = new Set(responsables.map((r) => String(r.codiRespnsble)));
const codigosCliente = new Set(clientes.map((c) => String(c.codiAsgrdra)));

let errores = 0;
let advertencias = 0;

const reportar = (tipo, msg) => {
  if (tipo === 'ERROR') errores += 1;
  else advertencias += 1;
  console.log(`  [${tipo}] ${msg}`);
};

// --- Responsables ---
const valsResp = (await SiniestroExpress.distinct('responsable')).filter(Boolean);
console.log(`Responsables: ${valsResp.length} valor(es) distinto(s)`);
for (const v of valsResp) {
  const raw = String(v);
  if (!codigosResponsable.has(raw)) {
    const resolved = resolverResponsableConIndice(raw, rIdx);
    if (resolved && resolved !== raw) {
      reportar('ERROR', `Responsable sin remapear: "${raw}" → debería ser "${resolved}"`);
    } else {
      reportar('ADVERTENCIA', `Responsable sin catálogo: "${raw}"`);
    }
  }
}

// --- Aseguradoras ---
const valsAseg = (await SiniestroExpress.distinct('aseguradora')).filter(Boolean);
console.log(`Aseguradoras: ${valsAseg.length} valor(es) distinto(s)`);
for (const v of valsAseg) {
  const raw = String(v);
  if (!codigosCliente.has(raw)) {
    const resolved = resolverClienteConIndice(raw, cIdx);
    if (resolved && resolved !== raw) {
      reportar('ERROR', `Aseguradora sin remapear: "${raw}" → debería ser "${resolved}"`);
    } else {
      reportar('ADVERTENCIA', `Aseguradora sin catálogo: "${raw}"`);
    }
  }
}

// --- Estados ---
const valsEst = (await SiniestroExpress.distinct('estadoProceso')).filter(Boolean);
console.log(`Estados: ${valsEst.length} valor(es) distinto(s)`);
for (const v of valsEst) {
  const raw = String(v);
  const resolved = resolverEstadoExpressConIndice(raw, eIdx);
  if (resolved && resolved !== raw) {
    reportar('ERROR', `Estado sin remapear: "${raw}" → debería ser "${resolved}"`);
  }
}

// --- Catálogos Express (amparo, analista, intermediario) ---
for (const tipo of ['amparo', 'analista', 'intermediario']) {
  const vals = (await SiniestroExpress.distinct(tipo)).filter(Boolean);
  let sinCatalogo = 0;
  let remapePendiente = 0;
  for (const v of vals) {
    const canon = normalizarConMapas(expressMaps, tipo, v);
    const count = await SiniestroExpress.countDocuments({ [tipo]: v });
    if (!canon) sinCatalogo += count;
    else if (canon !== v) remapePendiente += count;
  }
  console.log(`${tipo}: ${vals.length} distintos, ${remapePendiente} casos remapeables, ${sinCatalogo} sin catálogo`);
  if (remapePendiente > 0) {
    reportar('ADVERTENCIA', `${tipo}: ${remapePendiente} casos con variante de nombre remapeable`);
  }
  if (sinCatalogo > 0) {
    reportar('ADVERTENCIA', `${tipo}: ${sinCatalogo} casos con valor histórico fuera del catálogo Express`);
  }
}

// --- Fechas inválidas ---
const CAMPOS_FECHA = [
  'fechaSiniestro',
  'avisoSiniestro',
  'avisoSiniestroCompania',
  'fechaReciboDocumentos',
  'fechaCargueFiniquito',
  'fechaEnvioAutorizacion',
  'fechaRespuestaAnalista',
  'fechaCierre',
  'fechaSolicitudDocumentos',
  'fechaPresentacionCifras',
  'fechaFiniquitosFirmado',
];

let fechasInvalidas = 0;
for (const campo of CAMPOS_FECHA) {
  const docs = await SiniestroExpress.find({ [campo]: { $type: 'date', $exists: true } }, { [campo]: 1 }).lean();
  for (const doc of docs) {
    const val = doc[campo];
    if (val && Number.isNaN(new Date(val).getTime())) {
      fechasInvalidas += 1;
      reportar('ERROR', `Fecha inválida en ${campo} (_id ${doc._id})`);
    }
  }
}
console.log(`Fechas: ${fechasInvalidas === 0 ? 'OK' : fechasInvalidas + ' inválida(s)'}`);

// --- Duplicados simulados en filtros ---
const simularFiltro = async (campo, resolver, catalogo) => {
  const casos = await SiniestroExpress.find({}, { [campo]: 1 }).lean();
  const porClave = new Map();
  for (const doc of casos) {
    const raw = doc[campo];
    if (!raw) continue;
    const clave = resolver(String(raw), catalogo) || String(raw);
    porClave.set(clave, (porClave.get(clave) || 0) + 1);
  }
  return porClave.size;
};

console.log('\n--- Opciones únicas en filtros (simulado) ---');
console.log(`  Responsable: ${await simularFiltro('responsable', resolverResponsableConIndice, rIdx)}`);
console.log(`  Aseguradora: ${await simularFiltro('aseguradora', resolverClienteConIndice, cIdx)}`);
console.log(`  Estado: ${await simularFiltro('estadoProceso', resolverEstadoExpressConIndice, eIdx)}`);

console.log(`\n=== Resultado: ${errores} error(es), ${advertencias} advertencia(s) ===`);
if (errores > 0) {
  console.log('Ejecute: npm run remapear-catalogos-express');
  process.exitCode = 1;
}

await mongoose.disconnect();
