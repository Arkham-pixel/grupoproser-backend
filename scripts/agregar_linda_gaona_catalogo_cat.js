/**
 * Agrega a Linda Marcela Gaona Hurtado al catálogo CAT
 * (ajustadora + inspectora).
 *
 * Uso: node scripts/agregar_linda_gaona_catalogo_cat.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const PERSONA = {
  cedula: '1111202701',
  nombre: 'Linda Marcela Gaona Hurtado',
  email: 'ing.lgaona28455@gmail.com',
  telefono: '3106490155',
  ciudad: 'Todas',
};

const MODULOS = ['zurich', 'sura', 'previsora', 'allianz', 'equidadCat', 'bbvaCat'];

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
    ciudad: PERSONA.ciudad,
    modulos,
    updatedAt: new Date(),
  };

  if (match) {
    await Model.updateOne({ _id: match._id }, { $set: docSet });
    return { estado: 'ACTUALIZADO', codigo: docSet.codigo, modulos };
  }

  await Model.create({
    ...docSet,
    createdAt: new Date(),
  });
  return { estado: 'CREADO', codigo: docSet.codigo, modulos };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  const aju = await upsertCatalogo(AjustadorCatastrofico, `AJU-${PERSONA.cedula}`);
  const ins = await upsertCatalogo(InspectorCatastrofico, `INS-${PERSONA.cedula}`);

  console.log(
    JSON.stringify(
      {
        persona: PERSONA,
        ajustador: aju,
        inspector: ins,
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
