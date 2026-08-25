/**
 * Asigna ajustador + inspector en Seguros Alfa por rangos de consecutivo,
 * SOLO en casos que no tienen ajustador NI inspector.
 *
 * Rangos (n° final de ALFA-2026-08-N):
 *   Fabian 1-200 | Sandra 201-400 | Sergio 401-600 | Liliana 601-800
 *   Hernan 801-1000 | Andres 1001-1200 | Omar 1201-1400 | Camilo 1401+
 *
 * Uso:
 *   node scripts/asignarAjustadoresAlfaPorRangos.js
 *   DRY_RUN=false node scripts/asignarAjustadoresAlfaPorRangos.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const DRY = String(process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

/** Caso 200 queda en Fabian; Sandra arranca en 201 (evita solape del chat). */
const RANGOS = [
  { desde: 1, hasta: 200, alias: 'Fabian', match: [/fabian\s+bravo/i] },
  { desde: 201, hasta: 400, alias: 'Sandra', match: [/sandra\s+patricia/i] },
  { desde: 401, hasta: 600, alias: 'Sergio', match: [/^sergio\s+diaz$/i] },
  { desde: 601, hasta: 800, alias: 'Liliana', match: [/liliana\s+ximena\s+guzman/i, /liliana/i] },
  {
    desde: 801,
    hasta: 1000,
    alias: 'Hernan',
    match: [/herman\s+andres\s+guzman/i, /hernan\s+andres\s+guzman/i, /^hernan\b/i, /^herman\b/i],
    crearSiFalta: {
      nombre: 'HERMAN ANDRES GUZMAN ZUÑIGA',
      codigo: 'AJU-HERNAN-GZ',
      ciudad: 'Todas',
      modulos: [],
    },
  },
  {
    desde: 1001,
    hasta: 1200,
    alias: 'Andres',
    match: [/andres\s+dario\s+collazos/i, /collazos\s+velasco/i],
  },
  {
    desde: 1201,
    hasta: 1400,
    alias: 'Omar',
    match: [/omar\s+rodolfo\s+pico/i, /^omar\b/i],
  },
  {
    desde: 1401,
    hasta: 99999,
    alias: 'Camilo',
    match: [/camilo\s+ospina/i],
  },
];

function vacio(v) {
  return v == null || String(v).trim() === '';
}

function numCaso(consecutivo) {
  const m = String(consecutivo || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function rangoDe(n) {
  return RANGOS.find((r) => n >= r.desde && n <= r.hasta) || null;
}

async function asegurarEnCatalogo(db, persona) {
  const colAj = db.collection('gsk3cAppajustadorcatastrofico');
  const colIn = db.collection('gsk3cAppinspectorcatastrofico');

  let aj = null;
  for (const re of persona.match) {
    aj = await colAj.findOne({ nombre: re });
    if (aj) break;
  }

  if (!aj && persona.crearSiFalta) {
    const doc = {
      ...persona.crearSiFalta,
      actividad: 'CAMPO',
      activo: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (!DRY) {
      const r = await colAj.updateOne(
        { codigo: doc.codigo },
        { $set: doc },
        { upsert: true }
      );
      aj = await colAj.findOne({ codigo: doc.codigo });
      console.log(`[crear ajustador] ${doc.nombre} upserted=${r.upsertedCount || 0}`);
    } else {
      aj = doc;
      console.log(`[dry-run] crearía ajustador ${doc.nombre}`);
    }
  }

  if (!aj) return null;

  const nombre = String(aj.nombre).trim();

  // Inspector con el mismo nombre (si no existe)
  let insp = await colIn.findOne({ nombre: new RegExp(`^${nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (!insp) {
    const codigoInsp = `INS-${String(aj.codigo || 'X').replace(/^AJU-/, '').slice(0, 12)}`;
    const docIn = {
      codigo: codigoInsp,
      nombre,
      ciudad: aj.ciudad || 'Todas',
      modulos: aj.modulos || ['alfa'],
      activo: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (!DRY) {
      await colIn.updateOne({ codigo: codigoInsp }, { $set: docIn }, { upsert: true });
      insp = await colIn.findOne({ codigo: codigoInsp });
      console.log(`[crear inspector] ${nombre}`);
    } else {
      insp = docIn;
      console.log(`[dry-run] crearía inspector ${nombre}`);
    }
  }

  return { nombre, codigo: aj.codigo, inspector: String(insp?.nombre || nombre).trim() };
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);
const db = mongoose.connection.db;
const col = db.collection('gsk3cAppsegurosAlfaCasos');

const resolucion = {};
for (const r of RANGOS) {
  const persona = await asegurarEnCatalogo(db, r);
  resolucion[r.alias] = persona;
  if (!persona) {
    console.error(`NO ENCONTRADO: ${r.alias} — define el nombre completo o créalo en catálogo.`);
  } else {
    console.log(`OK ${r.alias}: ${persona.nombre} (${r.desde}-${r.hasta === 99999 ? '∞' : r.hasta})`);
  }
}

const faltantes = RANGOS.filter((r) => !resolucion[r.alias]).map((r) => r.alias);
if (faltantes.length) {
  console.error('\nAbortado. Faltan personas:', faltantes.join(', '));
  console.error('Corrige el script / catálogo y vuelve a correr.');
  await mongoose.disconnect();
  process.exit(1);
}

const casos = await col
  .find({})
  .project({ consecutivo: 1, ajustador: 1, inspector: 1 })
  .toArray();

const updates = [];
const resumen = {};
const omitidosConAsignacion = [];
const fueraDeRango = [];

for (const c of casos) {
  const n = numCaso(c.consecutivo);
  if (!n) continue;

  const tieneAj = !vacio(c.ajustador);
  const tieneIn = !vacio(c.inspector);
  if (tieneAj || tieneIn) {
    omitidosConAsignacion.push({
      consecutivo: c.consecutivo,
      n,
      ajustador: c.ajustador || null,
      inspector: c.inspector || null,
    });
    continue;
  }

  const rango = rangoDe(n);
  if (!rango) {
    fueraDeRango.push({ consecutivo: c.consecutivo, n });
    continue;
  }

  const persona = resolucion[rango.alias];
  updates.push({
    _id: c._id,
    consecutivo: c.consecutivo,
    n,
    alias: rango.alias,
    ajustador: persona.nombre,
    inspector: persona.inspector || persona.nombre,
  });
  resumen[rango.alias] = (resumen[rango.alias] || 0) + 1;
}

console.log(
  JSON.stringify(
    {
      dryRun: DRY,
      aActualizar: updates.length,
      omitidosYaAsignados: omitidosConAsignacion.length,
      fueraDeRango: fueraDeRango.length,
      resumen,
      muestra: updates.slice(0, 12),
      muestraFinal: updates.slice(-5),
    },
    null,
    2
  )
);

if (!DRY && updates.length) {
  let ok = 0;
  for (const u of updates) {
    const r = await col.updateOne(
      {
        _id: u._id,
        $and: [
          { $or: [{ ajustador: null }, { ajustador: '' }, { ajustador: { $exists: false } }] },
          { $or: [{ inspector: null }, { inspector: '' }, { inspector: { $exists: false } }] },
        ],
      },
      {
        $set: {
          ajustador: u.ajustador,
          inspector: u.inspector,
          updatedAt: new Date(),
        },
      }
    );
    if (r.modifiedCount) ok += 1;
  }
  console.log(`Aplicados: ${ok}/${updates.length}`);
} else {
  console.log('Dry-run: no se escribió nada. Para aplicar: DRY_RUN=false node scripts/asignarAjustadoresAlfaPorRangos.js');
}

await mongoose.disconnect();
