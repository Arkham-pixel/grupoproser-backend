/**
 * Equipo Alfa (agosto): ajustadores e inspectores fijos.
 * Fuente: EQUIPO ALFA AGOSTO.xlsx
 *
 * Uso: node scripts/equipo_alfa_cat.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const PERSONAS = [
  { nombre: 'FABIAN BRAVO', cedula: '1094269632' },
  { nombre: 'SANDRA PATRICIA SÁNCHEZ CAÑAS', cedula: '41923444' },
  { nombre: 'CAMILO OSPINA SÁNCHEZ', cedula: '1094963429' },
  { nombre: 'ANDRES DARIO COLLAZOS VELASCO', cedula: '10290219' },
  { nombre: 'LILIANA XIMENA GUZMAN ZUÑIGA', cedula: '1061695725' },
  { nombre: 'HERMAN ANDRES GUZMAN ZUÑIGA', cedula: '10294769' },
  { nombre: 'OMAR RODOLFO PICO QUINTERO', cedula: '91180692' },
  { nombre: 'VALENTINA COLLAZOS DIAZ', cedula: '1061701741' },
  { nombre: 'GUILLERMO HARVEY MUÑOZ PEÑA', cedula: '4617592' },
  { nombre: 'LEYNA LUCIA ALFONSO ROJAS', cedula: '1098662033' },
  { nombre: 'MARIA ALEJANDRA SOLANO MONDRAGON', cedula: '1130629353' },
];

function norm(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[.\s-]/g, '')
    .trim()
    .toUpperCase();
}

function tokensNombre(nombre) {
  return norm(nombre)
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length >= 3);
}

function coincideNombre(docNombre, objetivo) {
  const a = norm(docNombre);
  const b = norm(objetivo);
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = tokensNombre(a);
  const tb = tokensNombre(b);
  if (tb.length >= 2 && tb.every((t) => ta.includes(t))) return true;
  if (ta.length >= 2 && ta.every((t) => tb.includes(t))) return true;
  return false;
}

async function upsertEquipo(col, persona, prefijo) {
  const ced = String(persona.cedula).replace(/\D/g, '');
  const codigo = `${prefijo}-${ced}`;
  const existentes = await col.find({}).project({ codigo: 1, nombre: 1, modulos: 1, email: 1, telefono: 1 }).toArray();
  const porCodigo = existentes.find((e) => String(e.codigo || '').trim() === codigo);
  const porNombre = existentes.find((e) => coincideNombre(e.nombre, persona.nombre));
  const match = porCodigo || porNombre;

  const patch = {
    $set: {
      nombre: persona.nombre,
      ciudad: 'Todas',
      updatedAt: new Date(),
    },
    $addToSet: { modulos: 'alfa' },
  };

  if (match) {
    if (!String(match.codigo || '').trim()) patch.$set.codigo = codigo;
    else if (String(match.codigo).trim() !== codigo && !porCodigo) {
      patch.$set.codigo = codigo;
    }
    await col.updateOne({ _id: match._id }, patch);
    return {
      codigo: patch.$set.codigo || match.codigo,
      estado: 'ACTUALIZADO',
      codigoAnterior: match.codigo,
    };
  }

  await col.insertOne({
    codigo,
    nombre: persona.nombre,
    email: '',
    telefono: '',
    ciudad: 'Todas',
    modulos: ['alfa'],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { codigo, estado: 'CREADO' };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  const db = mongoose.connection.db;
  const colAj = db.collection('gsk3cAppajustadorcatastrofico');
  const colIns = db.collection('gsk3cAppinspectorcatastrofico');

  const resultados = [];
  const codigosAj = [];
  const codigosIns = [];

  for (const persona of PERSONAS) {
    const aj = await upsertEquipo(colAj, persona, 'AJU');
    const ins = await upsertEquipo(colIns, persona, 'INS');
    codigosAj.push(aj.codigo);
    codigosIns.push(ins.codigo);
    resultados.push({ nombre: persona.nombre, cedula: persona.cedula, ajustador: aj, inspector: ins });
    console.log(`✅ ${persona.nombre} · aj ${aj.estado} (${aj.codigo}) · insp ${ins.estado} (${ins.codigo})`);
  }

  const extraAj = await colAj.updateMany(
    { codigo: { $nin: codigosAj }, modulos: 'alfa' },
    { $pull: { modulos: 'alfa' }, $set: { updatedAt: new Date() } }
  );
  const extraIns = await colIns.updateMany(
    { codigo: { $nin: codigosIns }, modulos: 'alfa' },
    { $pull: { modulos: 'alfa' }, $set: { updatedAt: new Date() } }
  );

  const equipoAj = await colAj
    .find({ modulos: 'alfa' })
    .project({ codigo: 1, nombre: 1, ciudad: 1, modulos: 1 })
    .sort({ nombre: 1 })
    .toArray();
  const equipoIns = await colIns
    .find({ modulos: 'alfa' })
    .project({ codigo: 1, nombre: 1, ciudad: 1, modulos: 1 })
    .sort({ nombre: 1 })
    .toArray();

  console.log('\n========== RESUMEN ==========');
  console.log(
    JSON.stringify(
      {
        ajustadores: equipoAj,
        inspectores: equipoIns,
        otrosAjustadoresSinAlfa: extraAj.modifiedCount,
        otrosInspectoresSinAlfa: extraIns.modifiedCount,
      },
      null,
      2
    )
  );

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
