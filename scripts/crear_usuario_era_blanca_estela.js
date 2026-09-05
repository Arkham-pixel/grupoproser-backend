/**
 * Crea/actualiza a Blanca Estela Rivera Diaz (rol contractor_era)
 * y la registra en el catálogo de ajustadores Alfa.
 *
 * Uso: node scripts/crear_usuario_era_blanca_estela.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import SecurUser from '../models/SecurUser.js';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import { aplicarSufijoNombrePorRol } from '../config/roles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const ROL_ERA = 'contractor_era';
const PASSWORD = process.env.SEED_PASSWORD_ERA || 'Externos2026*';
const EMPRESA = 'ERA';

const PERSONA = {
  nombre: 'Blanca Estela Rivera Diaz',
  email: 'estela_rd84@msn.com',
  celular: '+52 (24) 6122.8750',
  fechaNacimiento: '1984-05-20',
  cedula: '0186050007215',
};

function codigoAjustadorEra(login) {
  return `AJU-ERA-${login}`;
}

async function upsertAjustadorAlfa({ codigo, nombre, email, telefono }) {
  const existente = await AjustadorCatastrofico.findOne({
    $or: [
      { codigo },
      { nombre: new RegExp(`^${nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    ],
  });

  const docSet = {
    codigo: existente?.codigo || codigo,
    nombre,
    email: email || existente?.email || '',
    telefono: telefono || existente?.telefono || '',
    ciudad: 'Todas',
    updatedAt: new Date(),
  };

  if (existente) {
    await AjustadorCatastrofico.updateOne(
      { _id: existente._id },
      { $set: docSet, $addToSet: { modulos: 'alfa' } }
    );
    return { codigo: docSet.codigo, estado: 'ACTUALIZADO' };
  }

  await AjustadorCatastrofico.create({
    ...docSet,
    modulos: ['alfa'],
    createdAt: new Date(),
  });
  return { codigo: docSet.codigo, estado: 'CREADO' };
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

  const ced = String(PERSONA.cedula).trim();
  const email = PERSONA.email.trim().toLowerCase();
  const hashed = await bcrypt.hash(PASSWORD, 10);
  const nombreUsuario = aplicarSufijoNombrePorRol(PERSONA.nombre, ROL_ERA);

  const payload = {
    name: nombreUsuario,
    login: ced,
    cedula: ced,
    email,
    pswd: hashed,
    role: ROL_ERA,
    active: 'Y',
    empresa: EMPRESA,
    phone: PERSONA.celular,
    celulares: PERSONA.celular,
    fechaNacimiento: new Date(`${PERSONA.fechaNacimiento}T12:00:00.000Z`),
  };

  const existente = await SecurUser.findOne({
    $or: [{ login: ced }, { cedula: ced }, { email }],
  });

  let usuarioEstado = 'CREADO';
  if (existente) {
    Object.assign(existente, payload);
    await existente.save();
    usuarioEstado = 'ACTUALIZADO';
    console.log(`🔄 Usuario actualizado: ${PERSONA.nombre} (login: ${ced})`);
  } else {
    await SecurUser.create(payload);
    console.log(`✅ Usuario creado: ${PERSONA.nombre} (login: ${ced})`);
  }

  const aj = await upsertAjustadorAlfa({
    codigo: codigoAjustadorEra(ced),
    nombre: PERSONA.nombre,
    email,
    telefono: PERSONA.celular,
  });
  console.log(`   Alfa ajustador ${aj.estado} (${aj.codigo})`);

  console.log('\n========== RESUMEN ==========');
  console.log(
    JSON.stringify(
      {
        nombre: PERSONA.nombre,
        login: ced,
        email,
        celular: PERSONA.celular,
        fechaNacimiento: '20/05/1984',
        rol: 'ERA',
        usuarioEstado,
        password: PASSWORD,
        ajustadorAlfa: aj,
      },
      null,
      2
    )
  );

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
