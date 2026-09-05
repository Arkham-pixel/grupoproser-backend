/**
 * ERA: inhabilita a quienes salieron y completa catálogo Alfa
 * (ajustadores e inspectores).
 *
 * Uso: node scripts/actualizar_equipo_era_alfa.js
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

const BAJAS = [
  { nombre: 'Jose Angel Flores Mena', login: '2372119921487' },
  { nombre: 'Miguel Angel Bojorges Mendez', login: '1997082904240' },
];

const ACTIVOS = [
  { nombre: 'Erick Aramis Quevedo Gonzalez', login: '4201038754011' },
  { nombre: 'César Rodríguez Gutiérrez', login: '2272085666324' },
  { nombre: 'Fernando Murillo Ánimas', login: '1003038350891' },
  { nombre: 'Ángel Jael Soto Cruz', login: '3987100038612' },
  { nombre: 'Rogelio Montoya de la Vega', login: '5473026805654' },
  { nombre: 'Yolanda Iris Vázquez Martínez', login: '3744082652881' },
  { nombre: 'Mitzy Yuriko Rangel Marin', login: '4240092522140' },
  { nombre: 'Mauricio Alfredo Zamora Hernandez', login: '0815104122085' },
  { nombre: 'Jorge Luis Perez Angulo', login: '0519072577601' },
  { nombre: 'Carlos Eduardo Luz Contreras', login: '5346081408584' },
  { nombre: 'Blanca Estela Rivera Diaz', login: '0186050007215' },
];

function escapeRx(valor) {
  return String(valor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nombreSinSufijo(nombre) {
  return String(nombre || '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

async function inhabilitarUsuario({ nombre, login }) {
  const rx = new RegExp(escapeRx(nombre).replace(/\s+/g, '\\s+'), 'i');
  const doc = await SecurUser.findOne({
    $or: [{ login }, { cedula: login }, { name: rx }],
  });
  if (!doc) return { nombre, login, estado: 'NO_ENCONTRADO' };
  doc.active = 'N';
  await doc.save();
  return {
    nombre: doc.name,
    login: doc.login,
    estado: 'INHABILITADO',
  };
}

async function quitarDeAlfa(Model, { nombre, login }) {
  const codigoEra = new RegExp(`-ERA-${escapeRx(login)}$`, 'i');
  const rxNombre = new RegExp(escapeRx(nombre).replace(/\s+/g, '\\s+'), 'i');
  const r = await Model.updateMany(
    { $or: [{ codigo: codigoEra }, { nombre: rxNombre }] },
    { $pull: { modulos: 'alfa' }, $set: { updatedAt: new Date() } }
  );
  return r.modifiedCount;
}

async function upsertCatalogoAlfa(Model, prefijo, persona, usuario) {
  const login = persona.login;
  const nombre = persona.nombre;
  const codigo = `${prefijo}-ERA-${login}`;
  const existente = await Model.findOne({
    $or: [
      { codigo },
      { nombre: new RegExp(`^${escapeRx(nombre)}$`, 'i') },
    ],
  });

  const email = String(usuario?.email || existente?.email || '').trim().toLowerCase();
  const telefono = String(usuario?.phone || usuario?.celulares || existente?.telefono || '').trim();
  const docSet = {
    codigo: existente?.codigo || codigo,
    nombre,
    email,
    telefono,
    ciudad: 'Todas',
    updatedAt: new Date(),
  };

  if (existente) {
    const yaAlfa = (existente.modulos || []).some((m) => String(m).toLowerCase() === 'alfa');
    await Model.updateOne(
      { _id: existente._id },
      { $set: docSet, $addToSet: { modulos: 'alfa' } }
    );
    return { codigo: docSet.codigo, estado: yaAlfa ? 'YA_ESTABA' : 'ACTUALIZADO' };
  }

  await Model.create({ ...docSet, modulos: ['alfa'], createdAt: new Date() });
  return { codigo: docSet.codigo, estado: 'CREADO' };
}

async function main() {
  if (!process.env.MONGO_URI && !process.env.MONGO_URI_DIRECT) {
    console.error('❌ Defina MONGO_URI en backend/.env');
    process.exit(1);
  }
  if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }

  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  console.log('✅ Conectado a MongoDB\n');

  console.log('--- Bajas ---');
  const bajas = [];
  for (const p of BAJAS) {
    const u = await inhabilitarUsuario(p);
    const aj = await quitarDeAlfa(AjustadorCatastrofico, p);
    const ins = await quitarDeAlfa(InspectorCatastrofico, p);
    bajas.push({ ...u, alfaAjustadorQuitado: aj, alfaInspectorQuitado: ins });
    console.log(`⛔ ${u.nombre || p.nombre} · ${u.login || p.login} · ${u.estado}`);
  }

  console.log('\n--- Catálogo Alfa (activos) ---');
  const catalogo = [];
  for (const p of ACTIVOS) {
    const usuario = await SecurUser.findOne({
      $or: [{ login: p.login }, { cedula: p.login }],
    }).lean();
    if (!usuario) {
      catalogo.push({ nombre: p.nombre, login: p.login, estado: 'USUARIO_NO_ENCONTRADO' });
      console.log(`⚠️  Sin usuario: ${p.nombre} (${p.login})`);
      continue;
    }
    const aj = await upsertCatalogoAlfa(AjustadorCatastrofico, 'AJU', p, usuario);
    const ins = await upsertCatalogoAlfa(InspectorCatastrofico, 'INS', p, usuario);
    catalogo.push({
      nombre: nombreSinSufijo(usuario.name),
      login: p.login,
      activo: usuario.active,
      ajustador: aj,
      inspector: ins,
    });
    console.log(
      `✅ ${p.nombre} · aj ${aj.estado} (${aj.codigo}) · insp ${ins.estado} (${ins.codigo})`
    );
  }

  console.log('\n========== RESUMEN ==========');
  console.log(JSON.stringify({ bajas, catalogo }, null, 2));

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
