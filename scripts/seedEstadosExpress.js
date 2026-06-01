/**
 * Carga el catálogo de estados Express (hoja Excel / Carga Express).
 *
 * Uso (desde /backend):
 *   node scripts/seedEstadosExpress.js
 *   node scripts/seedEstadosExpress.js --remap   # además convierte estadoProceso texto → código en casos
 */

import dns from 'dns';
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import EstadoExpress from '../models/EstadoExpress.js';
import SiniestroExpress from '../models/SiniestroExpress.js';

const ESTADOS_EXPRESS = [
  { codiEstdo: 1, descEstdo: 'ANALISIS SINIESTRO' },
  { codiEstdo: 2, descEstdo: 'DESISTIDO' },
  { codiEstdo: 3, descEstdo: 'EN ESPERA DE DOCUMENTOS' },
  { codiEstdo: 4, descEstdo: 'LIQUIDAR SINIESTRO' },
  { codiEstdo: 5, descEstdo: 'OBJETADO POR INDEMNIZACIONES' },
  { codiEstdo: 6, descEstdo: 'PENDIENTE ACEPTACION CLIENTE' },
  { codiEstdo: 7, descEstdo: 'PENDIENTE AUTORIZACION DELEGADA RESERVA' },
  { codiEstdo: 8, descEstdo: 'TRAMITADO A COMPLEX' },
];

const norm = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

const mongoOptions = {
  serverSelectionTimeoutMS: 30000,
  retryWrites: true,
  w: 'majority',
};

async function connectMongo() {
  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI no definido');
  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
  } else if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }
  await mongoose.connect(uri, mongoOptions);
}

async function seedEstados() {
  let creados = 0;
  let actualizados = 0;

  for (const estado of ESTADOS_EXPRESS) {
    const filtro = {
      $or: [{ codiEstdo: estado.codiEstdo }, { descEstdo: estado.descEstdo }],
    };
    const existente = await EstadoExpress.findOne(filtro);
    if (existente) {
      await EstadoExpress.updateOne(
        { _id: existente._id },
        { $set: { codiEstdo: estado.codiEstdo, descEstdo: estado.descEstdo } }
      );
      actualizados += 1;
    } else {
      await EstadoExpress.create(estado);
      creados += 1;
    }
  }

  return { creados, actualizados };
}

async function remapCasos() {
  const estados = await EstadoExpress.find().lean();
  const porDesc = new Map();
  for (const e of estados) {
    const desc = norm(e.descEstdo ?? e.descEstado);
    const codigo = String(e.codiEstdo ?? e.codiEstado ?? '');
    if (desc && codigo) porDesc.set(desc, codigo);
  }

  const casos = await SiniestroExpress.find({}, { estadoProceso: 1 }).lean();
  let actualizados = 0;
  let sinMapeo = new Set();

  for (const caso of casos) {
    const actual = caso.estadoProceso;
    if (actual == null || actual === '') continue;
    const actualStr = String(actual);
    if (/^\d+$/.test(actualStr) && porDesc.has(actualStr) === false) {
      const porCodigo = estados.find((e) => String(e.codiEstdo ?? e.codiEstado) === actualStr);
      if (porCodigo) continue;
    }
    if (/^\d+$/.test(actualStr)) {
      const existe = estados.some((e) => String(e.codiEstdo ?? e.codiEstado) === actualStr);
      if (existe) continue;
    }

    const codigo = porDesc.get(norm(actualStr));
    if (codigo && codigo !== actualStr) {
      await SiniestroExpress.updateOne({ _id: caso._id }, { $set: { estadoProceso: codigo } });
      actualizados += 1;
    } else if (!/^\d+$/.test(actualStr)) {
      sinMapeo.add(actualStr);
    }
  }

  return { actualizados, sinMapeo: [...sinMapeo] };
}

async function main() {
  const remap = process.argv.includes('--remap');

  await connectMongo();
  console.log('✅ MongoDB conectado\n');

  const { creados, actualizados } = await seedEstados();
  console.log('Catálogo gsk3cAppestadosExpress:');
  console.log(`  Nuevos: ${creados}, actualizados: ${actualizados}`);
  console.log('\nEstados configurados:');
  ESTADOS_EXPRESS.forEach((e) => console.log(`  ${e.codiEstdo} — ${e.descEstdo}`));

  if (remap) {
    console.log('\nRemapeando estadoProceso en casos Express...');
    const { actualizados: casosAct, sinMapeo } = await remapCasos();
    console.log(`  Casos actualizados: ${casosAct}`);
    if (sinMapeo.length) {
      console.log('  Sin código en catálogo:', sinMapeo.join(', '));
    }
  } else {
    console.log('\nTip: ejecute con --remap para convertir textos del Excel a códigos numéricos.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
