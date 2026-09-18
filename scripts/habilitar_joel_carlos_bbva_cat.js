/**
 * Habilita Joel Sosa y Carlos Baruch en catálogo BBVA CAT
 * (ajustador + inspector → $addToSet bbvaCat).
 *
 * Preferir API prod si Atlas local no responde:
 *   node scripts/habilitar_joel_carlos_bbva_cat.js --via-api
 *
 * Uso local Mongo: node scripts/habilitar_joel_carlos_bbva_cat.js
 */
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import { conectarMongoRobusto } from './_conectarMongoRobusto.js';
import { catalogoPerteneceAModulo } from '../utils/filtrarCatalogoPorModulo.js';

const PERSONAS = [
  {
    clave: 'joel',
    nombre: 'Joel Sosa Miralles',
    codigo: '2570216393',
    email: 'joelsosa8@gmail.com',
    telefono: '5520880539',
    modulosBase: ['alfa', 'previsora', 'bbvaCat'],
  },
  {
    clave: 'carlos',
    nombre: 'Carlos Baruch Castro Lara',
    codigo: 'N25174084',
    email: 'cbaruch.castro@gmail.com',
    telefono: '525591924268',
    modulosBase: ['bbvaCat'],
  },
];

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

function esMatch(doc, persona) {
  if (String(doc.codigo || '') === persona.codigo) return true;
  if (norm(doc.nombre) === norm(persona.nombre)) return true;
  return false;
}

async function habilitarEn(Model, persona) {
  const todos = await Model.find({}).select('codigo nombre email telefono ciudad modulos').lean();
  const hits = todos.filter((d) => esMatch(d, persona));
  if (!hits.length) {
    return { estado: 'NO_ENCONTRADO', hits: [] };
  }

  const resultados = [];
  for (const hit of hits) {
    const prev = Array.isArray(hit.modulos) ? hit.modulos : [];
    await Model.updateOne(
      { _id: hit._id },
      {
        $addToSet: { modulos: 'bbvaCat' },
        $set: { updatedAt: new Date() },
      }
    );
    const after = await Model.findById(hit._id).lean();
    resultados.push({
      codigo: after.codigo,
      nombre: after.nombre,
      antes: prev,
      despues: after.modulos || [],
      enListaBbva: catalogoPerteneceAModulo(after, 'bbvaCat'),
    });
  }
  return { estado: 'OK', hits: resultados };
}

async function viaMongo() {
  await conectarMongoRobusto();
  const out = {};
  for (const persona of PERSONAS) {
    out[persona.clave] = {
      buscado: persona.nombre,
      codigo: persona.codigo,
      ajustador: await habilitarEn(AjustadorCatastrofico, persona),
      inspector: await habilitarEn(InspectorCatastrofico, persona),
    };
  }
  console.log(JSON.stringify(out, null, 2));
}

async function viaApi() {
  const aj = (await (await fetch(`${API_BASE}/api/ajustadores-catastrofico`)).json()).data || [];
  const ins = (await (await fetch(`${API_BASE}/api/inspectores-catastrofico`)).json()).data || [];
  const out = {};
  for (const persona of PERSONAS) {
    const a = aj.find((d) => esMatch(d, persona));
    const i = ins.find((d) => esMatch(d, persona));
    out[persona.clave] = {
      nombre: persona.nombre,
      codigo: persona.codigo,
      ajustador: a
        ? { codigo: a.codigo, modulos: a.modulos, enListaBbva: catalogoPerteneceAModulo(a, 'bbvaCat') }
        : null,
      inspector: i
        ? { codigo: i.codigo, modulos: i.modulos, enListaBbva: catalogoPerteneceAModulo(i, 'bbvaCat') }
        : null,
    };
  }
  console.log(JSON.stringify({ modo: 'verificacion-api', ...out }, null, 2));
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
