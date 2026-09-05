/**
 * Equipo México: usuarios + ajustador e inspector catastrófico.
 *
 * Uso: node scripts/crear_equipo_mexico_cat.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import SecurUser from '../models/SecurUser.js';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import { aplicarSufijoNombrePorRol } from '../config/roles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const ROL = 'contractor_catastroficos';
const PASSWORD = process.env.SEED_PASSWORD_EQUIPO_MEXICO || 'Externo2026*';
const EMPRESA = 'Externo CAT México';

const PERSONAS = [
  {
    nombre: 'Marco Gonzales',
    cedula: '23289751',
    email: 'marco.gonzales.mx@externo.cat',
    modulo: 'zurich',
  },
  {
    nombre: 'Eduardo Viveros',
    cedula: '34043660',
    email: 'eduardo.viveros.mx@externo.cat',
    modulo: 'sura',
  },
  {
    nombre: 'Tito Garcia',
    cedula: '10647548',
    email: 'tito.garcia.mx@externo.cat',
    modulo: 'sura',
  },
  {
    nombre: 'Manuel Marquetti',
    cedula: '1698472128',
    email: 'manuel.marquetti.mx@externo.cat',
    modulo: 'allianz',
  },
];

function norm(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[.\s-]/g, '')
    .trim()
    .toUpperCase();
}

function codigoAjustador(cedula) {
  return `AJU-${String(cedula).replace(/\D/g, '')}`;
}

function codigoInspector(cedula) {
  return `INS-${String(cedula).replace(/\D/g, '')}`;
}

async function upsertCatalogo(Model, { codigo, nombre, email, modulo }) {
  const nombreNorm = norm(nombre);
  const existentes = await Model.find({}).select('codigo nombre email modulos').lean();
  const match = existentes.find((e) => {
    if (String(e.codigo || '').trim() === codigo) return true;
    if (norm(e.nombre) === nombreNorm) return true;
    return false;
  });

  const modsPrevios = Array.isArray(match?.modulos) ? match.modulos.filter(Boolean) : [];
  const modulos = [...new Set([...modsPrevios, modulo])];

  const docSet = {
    codigo: match?.codigo || codigo,
    nombre,
    email: email || match?.email || '',
    telefono: match?.telefono || '',
    ciudad: 'Todas',
    modulos,
    updatedAt: new Date(),
  };

  if (match?._id) {
    await Model.updateOne({ _id: match._id }, { $set: docSet });
    return { codigo: docSet.codigo, estado: 'ACTUALIZADO', modulos };
  }
  await Model.create({ ...docSet, telefono: '', createdAt: new Date() });
  return { codigo: docSet.codigo, estado: 'CREADO', modulos };
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
  });
  console.log('✅ Conectado a MongoDB\n');

  const hashed = await bcrypt.hash(PASSWORD, 10);
  const resultados = [];

  for (const p of PERSONAS) {
    const ced = String(p.cedula).replace(/\D/g, '');
    const email = String(p.email).trim().toLowerCase();
    const nombreUsuario = aplicarSufijoNombrePorRol(p.nombre, ROL);

    const existente = await SecurUser.findOne({
      $or: [{ login: ced }, { cedula: ced }, { email }],
    });

    const payload = {
      name: nombreUsuario,
      login: ced,
      cedula: ced,
      email,
      pswd: hashed,
      role: ROL,
      active: 'Y',
      empresa: EMPRESA,
    };

    let usuarioEstado = 'CREADO';
    if (existente) {
      Object.assign(existente, payload);
      await existente.save();
      usuarioEstado = 'ACTUALIZADO';
    } else {
      await SecurUser.create(payload);
    }

    const aj = await upsertCatalogo(AjustadorCatastrofico, {
      codigo: codigoAjustador(ced),
      nombre: p.nombre,
      email,
      modulo: p.modulo,
    });
    const insp = await upsertCatalogo(InspectorCatastrofico, {
      codigo: codigoInspector(ced),
      nombre: p.nombre,
      email,
      modulo: p.modulo,
    });

    resultados.push({
      nombre: p.nombre,
      login: ced,
      modulo: p.modulo,
      usuarioEstado,
      ajustador: aj,
      inspector: insp,
    });
    console.log(
      `✅ ${p.nombre} · login ${ced} · ${p.modulo} · user ${usuarioEstado} · aj ${aj.estado} · insp ${insp.estado}`
    );
  }

  console.log('\n========== RESUMEN ==========');
  console.log(JSON.stringify(resultados, null, 2));
  console.log(`\nContraseña: ${PASSWORD}`);
  console.log('Rol: contractor_catastroficos (Catastróficos)');

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
