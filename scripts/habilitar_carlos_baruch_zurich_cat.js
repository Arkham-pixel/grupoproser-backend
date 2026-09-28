/**
 * Habilita Carlos Baruch Castro Lara en catálogo Zurich CAT
 * (ajustador + inspector → $addToSet zurich).
 *
 * Uso: node scripts/habilitar_carlos_baruch_zurich_cat.js
 */
import mongoose from 'mongoose';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import { conectarMongoRobusto } from './_conectarMongoRobusto.js';
import { catalogoPerteneceAModulo } from '../utils/filtrarCatalogoPorModulo.js';

const PERSONA = {
  nombre: 'Carlos Baruch Castro Lara',
  codigo: 'N25174084',
  cedula: '25174084',
};

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
  if (codigo === PERSONA.codigo || codigo === PERSONA.cedula) return true;
  if (codigo === `N${PERSONA.cedula}`) return true;
  const nombre = norm(doc.nombre);
  return nombre === norm(PERSONA.nombre) || nombre.includes('CARLOSBARUCH');
}

async function habilitarEn(Model) {
  const todos = await Model.find({}).select('codigo nombre modulos').lean();
  const hits = todos.filter(esMatch);
  if (!hits.length) return { estado: 'NO_ENCONTRADO', hits: [] };

  const resultados = [];
  for (const hit of hits) {
    const prev = Array.isArray(hit.modulos) ? hit.modulos : [];
    await Model.updateOne(
      { _id: hit._id },
      { $addToSet: { modulos: 'zurich' }, $set: { updatedAt: new Date() } }
    );
    const after = await Model.findById(hit._id).lean();
    resultados.push({
      codigo: after.codigo,
      nombre: after.nombre,
      antes: prev,
      despues: after.modulos || [],
      enListaZurich: catalogoPerteneceAModulo(after, 'zurich'),
    });
  }
  return { estado: 'OK', hits: resultados };
}

await conectarMongoRobusto();
const out = {
  persona: PERSONA,
  ajustador: await habilitarEn(AjustadorCatastrofico),
  inspector: await habilitarEn(InspectorCatastrofico),
};
console.log(JSON.stringify(out, null, 2));
await mongoose.disconnect();
