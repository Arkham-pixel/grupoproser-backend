/**
 * Crea/actualiza a Javier Orlando Ramírez Rodríguez
 * con rol contractor_zurich (Zurich, Alfa, Sura y BBVA)
 * + catálogo inspector y ajustador general (no entra a equipos cerrados Alfa/BBVA).
 *
 * Uso: node scripts/crear_usuario_javier_ramirez.js
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

const ROL = 'contractor_zurich';
const PASSWORD = process.env.SEED_PASSWORD_AJUSTADORES_ALFA || 'Externos2026*';
const EMPRESA = 'Externo CAT';

const PERSONA = {
  nombre: 'Javier Orlando Ramírez Rodríguez',
  email: 'javierramirezrodriguez73@gmail.com',
  telefono: '3208591353',
  cedula: '79655067',
  fechaNacimiento: new Date(1973, 8, 14),
};

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

async function upsertCatalogo(Model, { codigo, nombre, email, telefono, ciudad }) {
  const tel = String(telefono || '').replace(/\D/g, '');
  const nombreNorm = norm(nombre);
  const existentes = await Model.find({}).select('codigo nombre telefono email modulos').lean();
  const match = existentes.find((e) => {
    if (String(e.codigo || '').trim() === codigo) return true;
    if (norm(e.nombre) === nombreNorm) return true;
    const eTel = String(e.telefono || '').replace(/\D/g, '');
    if (tel && eTel === tel && eTel.length >= 10) return true;
    return false;
  });

  const docSet = {
    codigo: match?.codigo || codigo,
    nombre,
    email: email || '',
    telefono: tel,
    ciudad: ciudad || 'Todas',
    modulos: Array.isArray(match?.modulos) && match.modulos.length ? match.modulos : [],
    updatedAt: new Date(),
  };

  if (match?._id) {
    await Model.updateOne({ _id: match._id }, { $set: docSet });
    return { codigo: docSet.codigo, estado: 'ACTUALIZADO', modulos: docSet.modulos };
  }
  await Model.create({ ...docSet, createdAt: new Date() });
  return { codigo: docSet.codigo, estado: 'CREADO', modulos: docSet.modulos };
}

async function main() {
  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
  } else if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }

  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  const hashed = await bcrypt.hash(PASSWORD, 10);
  const p = PERSONA;
  const ced = String(p.cedula).replace(/\D/g, '');
  const tel = String(p.telefono).replace(/\D/g, '');
  const email = String(p.email).trim().toLowerCase();
  const nombreUsuario = aplicarSufijoNombrePorRol(p.nombre, ROL);

  let usuarioEstado = 'CREADO';
  const existente = await SecurUser.findOne({
    $or: [{ login: ced }, { cedula: ced }, { email }],
  });

  if (existente) {
    existente.name = nombreUsuario;
    existente.login = ced;
    existente.cedula = ced;
    existente.email = email;
    existente.pswd = hashed;
    existente.role = ROL;
    existente.active = 'Y';
    existente.phone = tel;
    existente.celulares = tel;
    existente.fechaNacimiento = p.fechaNacimiento;
    existente.empresa = EMPRESA;
    await existente.save();
    usuarioEstado = 'ACTUALIZADO';
  } else {
    await SecurUser.create({
      name: nombreUsuario,
      login: ced,
      cedula: ced,
      email,
      pswd: hashed,
      role: ROL,
      active: 'Y',
      phone: tel,
      celulares: tel,
      fechaNacimiento: p.fechaNacimiento,
      empresa: EMPRESA,
    });
  }

    const aj = await upsertCatalogo(AjustadorCatastrofico, {
      codigo: codigoAjustador(ced),
      nombre: p.nombre,
      email,
      telefono: tel,
      ciudad: 'Todas',
    });
    await AjustadorCatastrofico.updateOne(
      { codigo: aj.codigo },
      { $addToSet: { modulos: 'bbvaCat' }, $set: { ciudad: 'Todas', updatedAt: new Date() } }
    );
  const insp = await upsertCatalogo(InspectorCatastrofico, {
    codigo: codigoInspector(ced),
    nombre: p.nombre,
    email,
    telefono: tel,
    ciudad: 'Todas',
  });

  const resumen = {
    nombre: p.nombre,
    login: ced,
    email,
    telefono: tel,
    fechaNacimiento: p.fechaNacimiento.toISOString().slice(0, 10),
    usuarioEstado,
    ajustador: aj,
    inspector: insp,
  };

  console.log(
    `✅ ${p.nombre} · login ${ced} · user ${usuarioEstado} · aj ${aj.estado} · insp ${insp.estado}`
  );
  console.log('\n========== RESUMEN ==========');
  console.log(JSON.stringify(resumen, null, 2));
  console.log(`\nContraseña: ${PASSWORD}`);
  console.log('Rol: contractor_zurich (Zurich, Alfa, Sura y BBVA)');

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
