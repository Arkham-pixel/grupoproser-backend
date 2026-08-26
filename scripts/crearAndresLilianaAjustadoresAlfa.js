/**
 * Crea/actualiza usuarios Andrés Dario Collazos y Liliana Ximena Guzmán
 * + catálogo ajustador e inspector (Zurich/Alfa/Sura/BBVA).
 *
 * Uso: node scripts/crearAndresLilianaAjustadoresAlfa.js
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

const ROL = 'contractor_zurich'; // Zurich, Alfa, Sura y BBVA
const PASSWORD = process.env.SEED_PASSWORD_AJUSTADORES_ALFA || 'Externos2026*';

const PERSONAS = [
  {
    nombre: 'Andres Dario Collazos Velasco',
    email: 'andresdcollazosv@gmail.com', // .com (el correo llegó como gmail.co)
    telefono: '3147919045',
    cedula: '10290219',
    fechaNacimiento: new Date(1981, 1, 21), // 21/02/1981
  },
  {
    nombre: 'Liliana Ximena Guzman Zuñiga',
    email: 'Liliana.x.guzman@gmail.com',
    telefono: '3016179338',
    cedula: '1061695725',
    fechaNacimiento: new Date(1987, 0, 16), // 16/01/1987
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

async function upsertCatalogo(Model, { codigo, nombre, email, telefono, ciudad }) {
  const tel = String(telefono || '').replace(/\D/g, '');
  const nombreNorm = norm(nombre);
  const existentes = await Model.find({}).select('codigo nombre telefono email').lean();
  const match = existentes.find((e) => {
    if (String(e.codigo || '').trim() === codigo) return true;
    if (norm(e.nombre) === nombreNorm) return true;
    const eTel = String(e.telefono || '').replace(/\D/g, '');
    if (tel && eTel === tel) return true;
    return false;
  });

  const docSet = {
    codigo: match?.codigo || codigo,
    nombre,
    email: email || '',
    telefono: tel,
    ciudad: ciudad || 'Todas',
    modulos: [], // catálogo general (aparece en Alfa y demás)
    updatedAt: new Date(),
  };

  if (match?._id) {
    await Model.updateOne({ _id: match._id }, { $set: docSet });
    return { codigo: docSet.codigo, estado: 'ACTUALIZADO' };
  }
  await Model.create({ ...docSet, createdAt: new Date() });
  return { codigo: docSet.codigo, estado: 'CREADO' };
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
  const resultados = [];

  for (const p of PERSONAS) {
    const ced = String(p.cedula).replace(/\D/g, '');
    const tel = String(p.telefono).replace(/\D/g, '');
    const nombreUsuario = aplicarSufijoNombrePorRol(p.nombre, ROL);

    let usuarioEstado = 'CREADO';
    const existente = await SecurUser.findOne({
      $or: [{ login: ced }, { cedula: ced }, { email: p.email }],
    });

    if (existente) {
      existente.name = nombreUsuario;
      existente.login = ced;
      existente.cedula = ced;
      existente.email = p.email;
      existente.pswd = hashed;
      existente.role = ROL;
      existente.active = 'Y';
      existente.phone = tel;
      existente.fechaNacimiento = p.fechaNacimiento;
      await existente.save();
      usuarioEstado = 'ACTUALIZADO';
    } else {
      await SecurUser.create({
        name: nombreUsuario,
        login: ced,
        cedula: ced,
        email: p.email,
        pswd: hashed,
        role: ROL,
        active: 'Y',
        phone: tel,
        fechaNacimiento: p.fechaNacimiento,
      });
    }

    const aj = await upsertCatalogo(AjustadorCatastrofico, {
      codigo: codigoAjustador(ced),
      nombre: p.nombre,
      email: p.email,
      telefono: tel,
      ciudad: 'Todas',
    });
    const insp = await upsertCatalogo(InspectorCatastrofico, {
      codigo: codigoInspector(ced),
      nombre: p.nombre,
      email: p.email,
      telefono: tel,
      ciudad: 'Todas',
    });

    resultados.push({
      nombre: p.nombre,
      login: ced,
      email: p.email,
      telefono: tel,
      usuarioEstado,
      ajustador: aj,
      inspector: insp,
    });
    console.log(`✅ ${p.nombre} · login ${ced} · user ${usuarioEstado} · aj ${aj.estado} · insp ${insp.estado}`);
  }

  console.log('\n========== RESUMEN ==========');
  console.log(JSON.stringify(resultados, null, 2));
  console.log(`\nContraseña: ${PASSWORD}`);
  console.log('Rol: contractor_zurich (Zurich, Alfa, Sura y BBVA)');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
