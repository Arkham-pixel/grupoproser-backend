/**
 * Habilita Joel Sosa Miralles en catálogo Zurich CAT
 * (ajustador + inspector → $addToSet zurich).
 *
 * Uso: node scripts/habilitar_joel_zurich_cat.js
 * Verificación solo API: node scripts/habilitar_joel_zurich_cat.js --via-api
 */
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import { conectarMongoRobusto } from './_conectarMongoRobusto.js';
import { catalogoPerteneceAModulo } from '../utils/filtrarCatalogoPorModulo.js';

const PERSONA = {
  nombre: 'Joel Sosa Miralles',
  codigo: '2570216393',
};

const API_BASE = process.env.PROD_API_BASE || 'https://arnaldbackend.grupoproser.com.co';

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
  if (String(doc.codigo || '') === PERSONA.codigo) return true;
  if (String(doc.codigo || '') === `AJU-${PERSONA.codigo}`) return true;
  if (String(doc.codigo || '') === `INS-${PERSONA.codigo}`) return true;
  if (String(doc.codigo || '') === `N${PERSONA.codigo}`) return true;
  if (norm(doc.nombre) === norm(PERSONA.nombre)) return true;
  return false;
}

async function habilitarEn(Model) {
  const todos = await Model.find({}).select('codigo nombre email telefono ciudad modulos').lean();
  const hits = todos.filter(esMatch);
  if (!hits.length) {
    return { estado: 'NO_ENCONTRADO', hits: [] };
  }

  const resultados = [];
  for (const hit of hits) {
    const prev = Array.isArray(hit.modulos) ? hit.modulos : [];
    await Model.updateOne(
      { _id: hit._id },
      {
        $addToSet: { modulos: 'zurich' },
        $set: { updatedAt: new Date() },
      }
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

async function viaMongo() {
  await conectarMongoRobusto();
  const out = {
    persona: PERSONA,
    ajustador: await habilitarEn(AjustadorCatastrofico),
    inspector: await habilitarEn(InspectorCatastrofico),
  };
  console.log(JSON.stringify(out, null, 2));
}

async function viaApi() {
  const aj = (await (await fetch(`${API_BASE}/api/ajustadores-catastrofico`)).json()).data || [];
  const ins = (await (await fetch(`${API_BASE}/api/inspectores-catastrofico`)).json()).data || [];
  const a = aj.find(esMatch);
  const i = ins.find(esMatch);
  console.log(
    JSON.stringify(
      {
        modo: 'verificacion-api',
        persona: PERSONA,
        ajustador: a
          ? {
              codigo: a.codigo,
              modulos: a.modulos,
              enListaZurich: catalogoPerteneceAModulo(a, 'zurich'),
            }
          : null,
        inspector: i
          ? {
              codigo: i.codigo,
              modulos: i.modulos,
              enListaZurich: catalogoPerteneceAModulo(i, 'zurich'),
            }
          : null,
      },
      null,
      2
    )
  );
}

async function main() {
  if (process.argv.includes('--via-api')) {
    await viaApi();
    return;
  }
  await viaMongo();
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
