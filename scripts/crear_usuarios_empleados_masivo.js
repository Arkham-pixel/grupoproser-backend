/**
 * Verifica cédulas en SecurUser y crea usuarios faltantes (rol usuario).
 * Uso: desde backend/ → node scripts/crear_usuarios_empleados_masivo.js
 * Requiere MONGO_URI en backend/.env
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import SecurUser from '../models/SecurUser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const SOLO_REPORTE = process.argv.includes('--solo-reporte');

const EMPLEADOS = [
  { cedula: '11432632771', nombre: 'ADRIANA ESTHER ANGULO FUNES' },
  { cedula: '1042241181', nombre: 'ALEJANDRO CARVAJAL BALLESTAS' },
  { cedula: '1140829957', nombre: 'ARNALDO ANDRES TAPIA GUTIERREZ' },
  { cedula: '8734788', nombre: 'AUGUSTO NICOLAS CAPARROSO MERCADO' },
  { cedula: '10061922232', nombre: 'BRAYAN STEVEN AGUIRRE ORTIZ' },
  { cedula: '1044800214', nombre: 'GABRIEL EDUARDO MORENO IMITOLA' },
  { cedula: '16482259', nombre: 'JIMMY GRUESO' },
  { cedula: '1005154551', nombre: 'JUAN PABLO VESGA CHAVEZ' },
  { cedula: '1001867248', nombre: 'MILAGRO DE JESUS NAVARRO HENRIQUEZ' },
  { cedula: '45765743', nombre: 'YANETH DEL CARMEN VITOLA SUAREZ' },
  { cedula: '1050968354', nombre: 'XAVIER EDUARDO ROJAS MARTINEZ' }
];

function generarPassword() {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const buf = crypto.randomBytes(14);
  return Array.from(buf, (b) => chars[b % chars.length]).join('');
}

function emailPlaceholder(cedula) {
  return `${cedula}@empleado.importacion.grupoproser`;
}

/** Variantes para detectar el mismo documento aunque esté guardado distinto */
function variantesCedula(ced) {
  const s = String(ced).trim();
  const soloDigitos = s.replace(/\D/g, '');
  const set = new Set([s]);
  if (soloDigitos && soloDigitos !== s) set.add(soloDigitos);
  // Algunos registros omiten ceros a la izquierda o los agregan
  const sinCeros = soloDigitos.replace(/^0+/, '') || '0';
  if (sinCeros !== soloDigitos) set.add(sinCeros);
  return [...set];
}

function queryUsuarioExistente(ced) {
  const vars = variantesCedula(ced);
  const emailPh = emailPlaceholder(ced);
  const or = [{ email: emailPh }];
  for (const v of vars) {
    or.push({ login: v }, { cedula: v });
  }
  return SecurUser.findOne({ $or: or }).lean();
}

async function main() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI no está definido (backend/.env)');
    process.exit(1);
  }

  const resultados = [];
  const mongoOptions = {
    serverSelectionTimeoutMS: 15000,
    retryWrites: true,
    w: 'majority'
  };

  // En algunos entornos Windows, querySrv a SRV de Atlas falla; DNS público lo evita.
  // Desactivar: MONGO_SKIP_PUBLIC_DNS=1 y definir MONGO_DNS_SERVERS si aplica.
  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
  } else if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }

  await mongoose.connect(process.env.MONGO_URI_DIRECT || MONGO_URI, mongoOptions);
  console.log('✅ Conectado a MongoDB\n');

  for (const emp of EMPLEADOS) {
    const ced = String(emp.cedula).trim();
    const existente = await queryUsuarioExistente(ced);

    if (existente) {
      resultados.push({
        cedula: ced,
        nombre: emp.nombre,
        login: existente.login || ced,
        password: null,
        estado: 'YA_EXISTIA',
        nota: 'No se generó contraseña nueva'
      });
      console.log(`⏭️  ${ced} — ya existe (${existente.name || existente.login})`);
      continue;
    }

    if (SOLO_REPORTE) {
      resultados.push({
        cedula: ced,
        nombre: emp.nombre,
        login: ced,
        password: null,
        estado: 'FALTANTE',
        nota: 'Ejecute sin --solo-reporte para crear y asignar contraseña'
      });
      console.log(`📋 ${ced} — no existe en la plataforma (pendiente de crear)`);
      continue;
    }

    const password = generarPassword();
    const hash = await bcrypt.hash(password, 10);
    const doc = new SecurUser({
      login: ced,
      cedula: ced,
      name: emp.nombre,
      email: emailPlaceholder(ced),
      pswd: hash,
      role: 'usuario',
      active: 'Y',
      phone: ''
    });

    try {
      await doc.save();
    } catch (err) {
      if (err?.code === 11000) {
        resultados.push({
          cedula: ced,
          nombre: emp.nombre,
          login: ced,
          password: null,
          estado: 'YA_EXISTIA',
          nota: 'Detección tardía (índice único)'
        });
        console.log(`⏭️  ${ced} — ya existía (clave duplicada al guardar)`);
        continue;
      }
      throw err;
    }
    resultados.push({
      cedula: ced,
      nombre: emp.nombre,
      login: ced,
      password,
      estado: 'CREADO'
    });
    console.log(`✅ ${ced} — usuario creado`);
  }

  await mongoose.disconnect();

  const outPath = path.join(__dirname, '../../usuarios_acceso_empleados.mb');
  const lineas = [
    'Grupo Proser — acceso empleados (importación)',
    `Generado: ${new Date().toISOString()}`,
    SOLO_REPORTE ? 'Modo: solo reporte (no se crearon usuarios)' : 'Modo: creación de faltantes',
    '',
    'Login en la plataforma = número de cédula (CC).',
    'Correo interno placeholder: {cedula}@empleado.importacion.grupoproser',
    '',
    'CC | Nombre | Login | Contraseña | Estado',
    '---|---|---|---|---'
  ];

  for (const r of resultados) {
    let pwdCol = r.password;
    if (!pwdCol) {
      if (r.estado === 'YA_EXISTIA') pwdCol = '(no aplicable — usuario ya existía)';
      else if (r.estado === 'FALTANTE') pwdCol = '(pendiente — ejecutar: npm run crear-usuarios-empleados)';
      else pwdCol = '(n/a)';
    }
    lineas.push(
      `${r.cedula} | ${r.nombre} | ${r.login} | ${pwdCol} | ${r.estado}`
    );
  }

  fs.writeFileSync(outPath, lineas.join('\n'), 'utf8');
  console.log(`\n📄 Archivo generado: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
