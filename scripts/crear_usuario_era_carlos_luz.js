/**
 * Crea/actualiza a Carlos Eduardo Luz Contreras (rol contractor_era)
 * y genera PDF de credenciales.
 *
 * Uso: desde backend/ → node scripts/crear_usuario_era_carlos_luz.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import SecurUser from '../models/SecurUser.js';
import { aplicarSufijoNombrePorRol } from '../config/roles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const ROL_ERA = 'contractor_era';
const PASSWORD_GENERICO = process.env.SEED_PASSWORD_ERA || 'Externos2026*';
const EMPRESA = 'ERA';

const PERSONA = {
  nombre: 'Carlos Eduardo Luz Contreras',
  email: 'charlyluz24@gmail.com',
  celular: '+52 (55) 6764.3113',
  fechaNacimiento: '1990-07-14',
  cedula: '5346081408584',
};

async function main() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('❌ Defina MONGO_URI en backend/.env');
    process.exit(1);
  }

  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
  } else if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }

  await mongoose.connect(process.env.MONGO_URI_DIRECT || MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
    retryWrites: true,
    w: 'majority',
  });
  console.log('✅ Conectado a MongoDB\n');

  const ced = PERSONA.cedula;
  const email = PERSONA.email.trim().toLowerCase();
  const hashedPassword = await bcrypt.hash(PASSWORD_GENERICO, 10);
  const nombreUsuario = aplicarSufijoNombrePorRol(PERSONA.nombre, ROL_ERA);
  const payload = {
    name: nombreUsuario,
    login: ced,
    cedula: ced,
    email,
    pswd: hashedPassword,
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

  let estado = 'CREADO';
  if (existente) {
    Object.assign(existente, payload);
    await existente.save();
    estado = 'ACTUALIZADO';
    console.log(`🔄 Usuario actualizado: ${PERSONA.nombre} (login: ${ced})`);
  } else {
    await SecurUser.create(payload);
    console.log(`✅ Usuario creado: ${PERSONA.nombre} (login: ${ced})`);
  }

  await mongoose.disconnect();

  const frontendScripts = path.join(__dirname, '../../grupoproser-frontend/scripts');
  const pdfScript = path.join(frontendScripts, 'generarCredencialesEraCarlosLuzPdf.mjs');
  const r = spawnSync(process.execPath, [pdfScript], {
    cwd: path.join(frontendScripts, '..'),
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error('❌ Falló la generación del PDF');
    process.exit(r.status || 1);
  }

  console.log('\n========== RESUMEN ==========');
  console.log(
    JSON.stringify(
      {
        nombre: PERSONA.nombre,
        login: ced,
        email,
        celular: PERSONA.celular,
        fechaNacimiento: '14/07/1990',
        rol: 'ERA',
        estado,
        password: PASSWORD_GENERICO,
      },
      null,
      2
    )
  );
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
