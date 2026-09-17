/**
 * Moisés quedó solo con bbvaCat; eso lo escondía de Previsora/Zurich/etc.
 * Le deja el catálogo general + BBVA (ajustador e inspector).
 *
 * Uso: node scripts/abrir_catalogo_general_moises.js
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

const GENERAL = ['zurich', 'sura', 'previsora', 'allianz', 'equidadCat'];
const CEDULA = '25347049';
const NOMBRE = 'Moisés Felipe Fernández Valencia';

function norm(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[.\s-]/g, '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .toUpperCase();
}

function esMatch(doc) {
  const codigo = String(doc.codigo || '').trim();
  if (codigo === `AJU-${CEDULA}` || codigo === `INS-${CEDULA}` || codigo === `N${CEDULA}`) {
    return true;
  }
  return norm(doc.nombre) === norm(NOMBRE) || String(codigo).includes(CEDULA);
}

async function abrirGeneral(Model) {
  const existentes = await Model.find({}).select('codigo nombre modulos').lean();
  const match = existentes.find(esMatch);
  if (!match) return { estado: 'NO_ENCONTRADO' };

  const prev = Array.isArray(match.modulos) ? match.modulos : [];
  const modulos = [...new Set([...prev, ...GENERAL, 'bbvaCat'])];
  await Model.updateOne({ _id: match._id }, { $set: { modulos, updatedAt: new Date() } });
  return { estado: 'ACTUALIZADO', codigo: match.codigo, antes: prev, despues: modulos };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  const ajustador = await abrirGeneral(AjustadorCatastrofico);
  const inspector = await abrirGeneral(InspectorCatastrofico);
  console.log(JSON.stringify({ ajustador, inspector }, null, 2));
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
