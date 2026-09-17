/**
 * Agrega a Moisés Felipe Fernández Valencia al equipo BBVA CAT
 * (ajustador + inspector con módulo bbvaCat).
 *
 * Uso: node scripts/agregar_moises_fernandez_bbva_cat.js
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
  cedula: '25347049',
  nombre: 'Moisés Felipe Fernández Valencia',
  email: 'm.f.fernandezvalencia@gmail.com',
  telefono: '3114064294',
  ciudad: 'Todas',
};

function norm(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[.\s-]/g, '')
    .trim()
    .toUpperCase();
}

async function upsertConBbva(Model, codigoPreferido) {
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

  const docSet = {
    codigo: match?.codigo || codigoPreferido,
    nombre: PERSONA.nombre,
    email: PERSONA.email,
    telefono: PERSONA.telefono,
    ciudad: PERSONA.ciudad,
    updatedAt: new Date(),
  };

  if (match) {
    await Model.updateOne(
      { _id: match._id },
      {
        $set: docSet,
        $addToSet: { modulos: 'bbvaCat' },
      }
    );
    const after = await Model.findById(match._id).lean();
    return { estado: 'ACTUALIZADO', codigo: after?.codigo, modulos: after?.modulos || [] };
  }

  await Model.create({
    ...docSet,
    modulos: ['bbvaCat'],
  });
  return { estado: 'CREADO', codigo: docSet.codigo, modulos: ['bbvaCat'] };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  const aju = await upsertConBbva(AjustadorCatastrofico, `AJU-${PERSONA.cedula}`);
  const ins = await upsertConBbva(InspectorCatastrofico, `INS-${PERSONA.cedula}`);

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
