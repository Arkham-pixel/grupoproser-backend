/**
 * Agrega / habilita Bernabé Esteban Díaz (72046066) en catálogo SURA CAT
 * como ajustador e inspector.
 *
 * Uso: node scripts/habilitar_bernabe_sura_cat.js
 */
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import SecurUser from '../models/SecurUser.js';
import { conectarMongoRobusto } from './_conectarMongoRobusto.js';
import { catalogoPerteneceAModulo } from '../utils/filtrarCatalogoPorModulo.js';

const PERSONA = {
  cedula: '72046066',
  nombre: 'Bernabé Esteban Díaz',
};

const MODULO = 'sura';

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
  const cod = String(doc.codigo || '').trim();
  if (cod === PERSONA.cedula) return true;
  if (cod === `AJU-${PERSONA.cedula}`) return true;
  if (cod === `INS-${PERSONA.cedula}`) return true;
  if (cod === `N${PERSONA.cedula}`) return true;
  if (norm(doc.nombre) === norm(PERSONA.nombre)) return true;
  if (norm(doc.nombre).includes('BERNABE') && norm(doc.nombre).includes('DIAZ')) return true;
  return false;
}

async function upsertCatalogo(Model, codigoPreferido, extras = {}) {
  const todos = await Model.find({})
    .select('codigo nombre email telefono ciudad modulos')
    .lean();
  const match = todos.find(esMatch);

  if (match) {
    const prev = Array.isArray(match.modulos) ? match.modulos : [];
    await Model.updateOne(
      { _id: match._id },
      {
        $addToSet: { modulos: MODULO },
        $set: {
          nombre: PERSONA.nombre,
          ...(extras.email ? { email: extras.email } : {}),
          ...(extras.telefono ? { telefono: extras.telefono } : {}),
          updatedAt: new Date(),
        },
      }
    );
    const after = await Model.findById(match._id).lean();
    return {
      estado: 'ACTUALIZADO',
      codigo: after.codigo,
      nombre: after.nombre,
      antes: prev,
      despues: after.modulos || [],
      enListaSura: catalogoPerteneceAModulo(after, MODULO),
    };
  }

  const doc = {
    codigo: codigoPreferido,
    nombre: PERSONA.nombre,
    email: extras.email || '',
    telefono: extras.telefono || '',
    ciudad: 'Todas',
    modulos: [MODULO],
  };
  await Model.create(doc);
  const after = await Model.findOne({ codigo: codigoPreferido }).lean();
  return {
    estado: 'CREADO',
    codigo: after.codigo,
    nombre: after.nombre,
    antes: [],
    despues: after.modulos || [],
    enListaSura: catalogoPerteneceAModulo(after, MODULO),
  };
}

async function main() {
  await conectarMongoRobusto();

  const user = await SecurUser.findOne({
    $or: [{ login: PERSONA.cedula }, { cedula: PERSONA.cedula }],
  })
    .select('login name email phone celulares role active')
    .lean();

  const extras = {
    email: String(user?.email || '').trim(),
    telefono: String(user?.phone || user?.celulares || '').trim(),
  };

  const out = {
    persona: PERSONA,
    usuarioArnald: user
      ? {
          login: user.login,
          name: user.name,
          role: user.role,
          active: user.active,
          email: user.email,
        }
      : null,
    ajustador: await upsertCatalogo(AjustadorCatastrofico, `AJU-${PERSONA.cedula}`, extras),
    inspector: await upsertCatalogo(InspectorCatastrofico, `INS-${PERSONA.cedula}`, extras),
  };

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
