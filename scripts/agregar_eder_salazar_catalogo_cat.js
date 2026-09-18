/**
 * Agrega a Eder Fernando Salazar Pérez al catálogo CAT
 * (ajustador + inspector) y crea usuario Arnald.
 *
 * Uso: node scripts/agregar_eder_salazar_catalogo_cat.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import SecurUser from '../models/SecurUser.js';
import { aplicarSufijoNombrePorRol } from '../config/roles.js';
import {
  catalogoPerteneceAModulo,
  esModuloBbvaCat,
} from '../utils/filtrarCatalogoPorModulo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const PERSONA = {
  cedula: '6162405',
  nombre: 'Eder Fernando Salazar Pérez',
  email: 'CREARQ.4@gmail.com',
  telefono: '',
  ciudad: 'Buenaventura',
  fechaNacimiento: new Date('1980-01-19T12:00:00.000Z'),
  profesion: 'ARQUITECTO',
};

const MODULOS = ['zurich', 'sura', 'previsora', 'allianz', 'equidadCat', 'bbvaCat'];
const ROL = 'contractor_catastroficos';
const PASSWORD = process.env.SEED_PASSWORD_CATASTROFICOS || 'Externos2026*';

function norm(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[.\s-]/g, '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .toUpperCase();
}

async function upsertCatalogo(Model, codigoPreferido) {
  const existentes = await Model.find({})
    .select('codigo nombre email telefono ciudad modulos')
    .lean();
  const nombreNorm = norm(PERSONA.nombre);
  const match = existentes.find((e) => {
    if (String(e.codigo || '').trim() === codigoPreferido) return true;
    if (String(e.codigo || '').trim() === `N${PERSONA.cedula}`) return true;
    if (norm(e.nombre) === nombreNorm) return true;
    return false;
  });

  const prevMods = Array.isArray(match?.modulos) ? match.modulos : [];
  const modulos = [...new Set([...prevMods, ...MODULOS])];
  const docSet = {
    codigo: match?.codigo || codigoPreferido,
    nombre: PERSONA.nombre,
    email: PERSONA.email,
    telefono: PERSONA.telefono,
    ciudad: 'Todas',
    modulos,
    updatedAt: new Date(),
  };

  if (match) {
    await Model.updateOne({ _id: match._id }, { $set: docSet });
    const after = await Model.findById(match._id).lean();
    return { estado: 'ACTUALIZADO', codigo: after.codigo, nombre: after.nombre, modulos: after.modulos };
  }

  await Model.create({ ...docSet, createdAt: new Date() });
  return { estado: 'CREADO', codigo: docSet.codigo, nombre: docSet.nombre, modulos };
}

async function upsertUsuario() {
  const hashed = await bcrypt.hash(PASSWORD, 10);
  const nombreUsuario = aplicarSufijoNombrePorRol(PERSONA.nombre, ROL);
  const existente = await SecurUser.findOne({
    $or: [{ login: PERSONA.cedula }, { cedula: PERSONA.cedula }, { email: PERSONA.email }],
  });

  const payload = {
    name: nombreUsuario,
    login: PERSONA.cedula,
    cedula: PERSONA.cedula,
    email: PERSONA.email,
    pswd: hashed,
    role: ROL,
    active: 'Y',
    phone: PERSONA.telefono,
    celulares: PERSONA.telefono,
    sucursal: PERSONA.ciudad,
    cargos: PERSONA.profesion,
    fechaNacimiento: PERSONA.fechaNacimiento,
    empresa: 'Grupo Proser',
  };

  if (existente) {
    Object.assign(existente, payload);
    await existente.save();
    return { estado: 'ACTUALIZADO', login: existente.login, role: existente.role };
  }

  await SecurUser.create(payload);
  return { estado: 'CREADO', login: PERSONA.cedula, role: ROL };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  const usuario = await upsertUsuario();
  const ajustador = await upsertCatalogo(AjustadorCatastrofico, `AJU-${PERSONA.cedula}`);
  const inspector = await upsertCatalogo(InspectorCatastrofico, `INS-${PERSONA.cedula}`);

  const ajuDoc = await AjustadorCatastrofico.findOne({ codigo: ajustador.codigo }).lean();
  const insDoc = await InspectorCatastrofico.findOne({ codigo: inspector.codigo }).lean();

  const verificacion = {
    enListaBbvaAjustadores: catalogoPerteneceAModulo(ajuDoc, 'bbvaCat'),
    enListaBbvaInspectores: catalogoPerteneceAModulo(insDoc, 'bbvaCat'),
    enListaZurichAjustadores: catalogoPerteneceAModulo(ajuDoc, 'zurich'),
    enListaZurichInspectores: catalogoPerteneceAModulo(insDoc, 'zurich'),
    totalAjustadoresBbva: (
      await AjustadorCatastrofico.find({}).lean()
    ).filter((d) => catalogoPerteneceAModulo(d, 'bbvaCat')).length,
    totalInspectoresBbva: (
      await InspectorCatastrofico.find({}).lean()
    ).filter((d) => catalogoPerteneceAModulo(d, 'bbvaCat')).length,
    aparecePorNombreAju: Boolean(
      (await AjustadorCatastrofico.find({}).lean()).find(
        (d) =>
          catalogoPerteneceAModulo(d, 'bbvaCat') &&
          norm(d.nombre).includes('EDERFERNANDOSALAZAR')
      )
    ),
    aparecePorNombreIns: Boolean(
      (await InspectorCatastrofico.find({}).lean()).find(
        (d) =>
          catalogoPerteneceAModulo(d, 'bbvaCat') &&
          norm(d.nombre).includes('EDERFERNANDOSALAZAR')
      )
    ),
    filtroUsaBbva: esModuloBbvaCat('bbvaCat'),
  };

  console.log(
    JSON.stringify(
      {
        persona: PERSONA,
        usuario,
        passwordTemporal: PASSWORD,
        ajustador,
        inspector,
        verificacion,
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
