/**
 * Upsert Giselle Marcela Osorio Sierra en catálogo CAT
 * (ajustador + inspector) con módulos generales + Zurich.
 *
 * Uso: node scripts/habilitar_giselle_osorio_catalogo_cat.js
 */
import mongoose from 'mongoose';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import SecurUser from '../models/SecurUser.js';
import { conectarMongoRobusto } from './_conectarMongoRobusto.js';
import { catalogoPerteneceAModulo } from '../utils/filtrarCatalogoPorModulo.js';

const PERSONA = {
  nombre: 'Giselle Marcela Osorio Sierra',
  login: '1015418630',
  cedula: '1015418630',
  ciudad: 'Todas',
};

/** Módulos CAT generales (sin Alfa exclusivo). */
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

function esMatch(doc) {
  const codigo = String(doc.codigo || '').trim();
  if (codigo === PERSONA.cedula || codigo === PERSONA.login) return true;
  if (codigo === `AJU-${PERSONA.cedula}` || codigo === `INS-${PERSONA.cedula}`) return true;
  if (codigo === `N${PERSONA.cedula}`) return true;
  return norm(doc.nombre) === norm(PERSONA.nombre);
}

async function upsertCatalogo(Model, codigoPreferido) {
  const todos = await Model.find({}).select('codigo nombre email telefono ciudad modulos').lean();
  const hit = todos.find(esMatch);
  const user = await SecurUser.findOne({
    $or: [{ login: PERSONA.login }, { cedula: PERSONA.cedula }],
  })
    .select('email phone name')
    .lean();

  const prevMods = Array.isArray(hit?.modulos) ? hit.modulos : [];
  const modulos = [...new Set([...prevMods, ...MODULOS])];
  const docSet = {
    codigo: hit?.codigo || codigoPreferido,
    nombre: PERSONA.nombre,
    email: hit?.email || user?.email || '',
    telefono: hit?.telefono || user?.phone || '',
    ciudad: PERSONA.ciudad,
    modulos,
    updatedAt: new Date(),
  };

  if (hit) {
    await Model.updateOne({ _id: hit._id }, { $set: docSet });
    const after = await Model.findById(hit._id).lean();
    return {
      estado: 'ACTUALIZADO',
      codigo: after.codigo,
      nombre: after.nombre,
      antes: prevMods,
      despues: after.modulos || [],
      enZurich: catalogoPerteneceAModulo(after, 'zurich'),
      enBbva: catalogoPerteneceAModulo(after, 'bbvaCat'),
    };
  }

  await Model.create({ ...docSet, createdAt: new Date() });
  return {
    estado: 'CREADO',
    codigo: docSet.codigo,
    nombre: docSet.nombre,
    antes: [],
    despues: modulos,
    enZurich: catalogoPerteneceAModulo(docSet, 'zurich'),
    enBbva: catalogoPerteneceAModulo(docSet, 'bbvaCat'),
  };
}

await conectarMongoRobusto();
const user = await SecurUser.findOne({
  $or: [{ login: PERSONA.login }, { cedula: PERSONA.cedula }],
})
  .select('login name role active')
  .lean();

const out = {
  persona: PERSONA,
  usuario: user || null,
  ajustador: await upsertCatalogo(AjustadorCatastrofico, PERSONA.cedula),
  inspector: await upsertCatalogo(InspectorCatastrofico, PERSONA.cedula),
};
console.log(JSON.stringify(out, null, 2));
await mongoose.disconnect();
process.exit(0);
