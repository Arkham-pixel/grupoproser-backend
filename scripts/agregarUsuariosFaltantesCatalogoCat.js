/**
 * Agrega al catálogo CAT (inspector + ajustador) los usuarios recientes
 * que ya existen en securUsers y aún no están en ambas listas.
 *
 * Uso: node scripts/agregarUsuariosFaltantesCatalogoCat.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import SecurUser from '../models/SecurUser.js';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

/** Catálogo general: Zurich, Sura, Previsora, Allianz, Equidad CAT (no Alfa ni BBVA). */
const GENERAL = [
  { login: '1008253187', nombre: 'Jonnathan Gutierrez Jurado' },
  { login: '1041900044', nombre: 'Karla Andrea Parada Rocha' },
  { login: '1095800166', nombre: 'Juan Camilo Pardo Mesa' },
  { login: '1130615470', nombre: 'Sindy Marcela Gomez Gomez' },
  { login: '1140829990', nombre: 'Marisol Gómez Carreño' },
  { login: '80255152', nombre: 'Cesar Octavio Cantillo Piraquive' },
  { login: '19358017', nombre: 'Javier Bernardo Jaramillo Villegas' },
  { login: '1083433781', nombre: 'Yury Carolina Morantes' },
  { login: '79592767', nombre: 'Ricardo Javier Guzman Gil' },
];

/** Equipo ERA: solo módulo Alfa. */
const ERA = [
  { login: '2570216393', nombre: 'Joel Sosa Miralles' },
  { login: '2973371677', nombre: 'Josenrique Martinez Alba' },
];

function norm(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[.\s-]/g, '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .toUpperCase();
}

function nombreSinSufijo(nombre) {
  return String(nombre || '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

async function upsertCatalogo(Model, { codigo, nombre, email, telefono, modulos }) {
  const nombreNorm = norm(nombre);
  const existentes = await Model.find({})
    .select('codigo nombre email ciudad telefono modulos')
    .lean();
  const match = existentes.find((e) => {
    if (String(e.codigo || '').trim() === codigo) return true;
    if (norm(nombreSinSufijo(e.nombre)) === nombreNorm) return true;
    return false;
  });

  const docSet = {
    codigo: match?.codigo || codigo,
    nombre,
    email: email || match?.email || '',
    telefono: telefono || match?.telefono || '',
    ciudad: match?.ciudad || 'Todas',
    updatedAt: new Date(),
  };

  if (modulos === undefined) {
    docSet.modulos = Array.isArray(match?.modulos) ? match.modulos : [];
  } else {
    docSet.modulos = modulos;
  }

  if (match) {
    const setOp = { $set: docSet };
    if (Array.isArray(modulos) && modulos.includes('alfa')) {
      setOp.$addToSet = { modulos: 'alfa' };
      delete setOp.$set.modulos;
    }
    await Model.updateOne({ _id: match._id }, setOp);
    return { estado: 'ACTUALIZADO', codigo: docSet.codigo };
  }

  await Model.create({
    codigo: docSet.codigo,
    nombre: docSet.nombre,
    email: docSet.email,
    telefono: docSet.telefono,
    ciudad: docSet.ciudad,
    modulos: Array.isArray(modulos) ? modulos : [],
  });
  return { estado: 'CREADO', codigo: docSet.codigo };
}

async function procesar(persona, { prefijoAj, prefijoIns, modulos }) {
  const login = String(persona.login).trim();
  const usuario = await SecurUser.findOne({
    $or: [{ login }, { cedula: login }],
  }).lean();
  if (!usuario) {
    return { nombre: persona.nombre, login, estado: 'USUARIO_NO_ENCONTRADO' };
  }

  const email = String(usuario.email || '').trim().toLowerCase();
  const telefono = String(usuario.phone || usuario.celulares || '').trim();
  const nombre = persona.nombre || nombreSinSufijo(usuario.name);

  const ajustador = await upsertCatalogo(AjustadorCatastrofico, {
    codigo: `${prefijoAj}-${login}`,
    nombre,
    email,
    telefono,
    modulos,
  });
  const inspector = await upsertCatalogo(InspectorCatastrofico, {
    codigo: `${prefijoIns}-${login}`,
    nombre,
    email,
    telefono,
    modulos,
  });

  return {
    nombre,
    login,
    email,
    telefono,
    role: usuario.role,
    ajustador,
    inspector,
  };
}

async function main() {
  if (!process.env.MONGO_URI && !process.env.MONGO_URI_DIRECT) {
    console.error('❌ Defina MONGO_URI en backend/.env');
    process.exit(1);
  }
  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
  } else if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }

  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
    retryWrites: true,
    w: 'majority',
  });
  console.log('✅ Conectado a MongoDB\n');

  const resultados = [];

  console.log('--- Catálogo general (todas menos Alfa/BBVA) ---');
  for (const p of GENERAL) {
    const r = await procesar(p, { prefijoAj: 'AJU', prefijoIns: 'INS', modulos: [] });
    resultados.push({ ...r, catalogo: 'general' });
    if (r.estado === 'USUARIO_NO_ENCONTRADO') {
      console.log(`⚠️  Sin usuario: ${p.nombre} (${p.login})`);
      continue;
    }
    console.log(
      `✅ ${r.nombre} · aj ${r.ajustador.estado} (${r.ajustador.codigo}) · insp ${r.inspector.estado} (${r.inspector.codigo})`
    );
  }

  console.log('\n--- ERA (solo Alfa) ---');
  for (const p of ERA) {
    const r = await procesar(p, { prefijoAj: 'AJU-ERA', prefijoIns: 'INS-ERA', modulos: ['alfa'] });
    resultados.push({ ...r, catalogo: 'alfa' });
    if (r.estado === 'USUARIO_NO_ENCONTRADO') {
      console.log(`⚠️  Sin usuario: ${p.nombre} (${p.login})`);
      continue;
    }
    console.log(
      `✅ ${r.nombre} · aj ${r.ajustador.estado} (${r.ajustador.codigo}) · insp ${r.inspector.estado} (${r.inspector.codigo})`
    );
  }

  console.log('\n========== RESUMEN ==========');
  console.log(JSON.stringify(resultados, null, 2));

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Error:', err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
