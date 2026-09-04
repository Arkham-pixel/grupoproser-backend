/**
 * Reparte los casos Alfa del convenio México entre los ajustadores de la firma ERA.
 *
 * Universo: casos con `fechaEmailConvenioMexico` (los que recibieron el correo del
 * convenio) y que no están excluidos de la base Alfa.
 *
 * Reparto: 10 de los 11 usuarios ERA. El líder de la firma (Erick Aramis Quevedo
 * Gonzalez, login 4201038754011) no recibe casos: ve y edita todo el pool por su
 * condición de líder.
 *
 * Criterio: cupos parejos (~total/10) agrupando por departamento + ciudad, para que
 * los predios de una misma ciudad queden con el mismo ajustador siempre que quepan.
 *
 * Escribe `ajustador`, `inspector` (misma persona), `firmaAjuste = 'ERA'` y guarda el
 * equipo Proser anterior en `ajustadorProserPrevio` / `inspectorProserPrevio`.
 * Usa el driver nativo para no disparar las notificaciones operativas del modelo.
 *
 * Uso:
 *   node scripts/asignarCasosEraAlfa.js            (dry-run)
 *   node scripts/asignarCasosEraAlfa.js --apply
 */
import dns from 'dns';
import dotenv from 'dotenv';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const APLICAR = process.argv.includes('--apply');
const LOGIN_LIDER_ERA = '4201038754011';
const FIRMA = 'ERA';

const COL_CASOS = 'gsk3cAppsegurosAlfaCasos';
const COL_USUARIOS = 'securUsers';
const COL_AJUSTADORES = 'gsk3cAppajustadorcatastrofico';
const COL_INSPECTORES = 'gsk3cAppinspectorcatastrofico';

function nombreSinSufijoRol(nombre) {
  return String(nombre || '')
    .replace(/\s*\((?:ERA|Alfa|Zurich|Sura|BBVA)\)\s*$/i, '')
    .trim();
}

function norm(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function vacio(valor) {
  return valor == null || String(valor).trim() === '';
}

function esNombreEra(valor, nombresEra) {
  return nombresEra.has(norm(valor));
}

function numConsecutivo(consecutivo) {
  const m = String(consecutivo || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

/** Upsert de la persona ERA en los catálogos de ajustador e inspector del módulo Alfa. */
async function asegurarCatalogo(col, persona, prefijo) {
  const codigo = `${prefijo}-ERA-${persona.login}`;
  const existente =
    (await col.findOne({ codigo })) ||
    (await col.findOne({ nombre: new RegExp(`^${persona.nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }));

  if (existente) {
    if (APLICAR) {
      await col.updateOne(
        { _id: existente._id },
        {
          $set: { codigo, nombre: persona.nombre, ciudad: 'Todas', email: persona.email || '', updatedAt: new Date() },
          $addToSet: { modulos: 'alfa' },
        }
      );
    }
    return { codigo, estado: 'ACTUALIZADO' };
  }

  if (APLICAR) {
    await col.insertOne({
      codigo,
      nombre: persona.nombre,
      email: persona.email || '',
      telefono: persona.telefono || '',
      ciudad: 'Todas',
      modulos: ['alfa'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  return { codigo, estado: 'CREADO' };
}

/**
 * Cupos parejos: los primeros `resto` ajustadores llevan un caso más.
 */
function calcularCupos(total, cantidadPersonas) {
  const base = Math.floor(total / cantidadPersonas);
  const resto = total % cantidadPersonas;
  return Array.from({ length: cantidadPersonas }, (_, i) => base + (i < resto ? 1 : 0));
}

/**
 * Reparto por bloques de departamento + ciudad respetando el cupo de cada persona.
 * Los bloques grandes se parten solo cuando no caben completos en nadie.
 */
function repartirPorCiudad(casos, personas) {
  const cupos = calcularCupos(casos.length, personas.length);
  const estado = personas.map((p, i) => ({ persona: p, cupo: cupos[i], asignados: [], ciudades: new Set() }));

  const bloques = new Map();
  for (const caso of casos) {
    const clave = `${norm(caso.departamento) || 'SIN DEPARTAMENTO'} | ${norm(caso.ciudad) || 'SIN CIUDAD'}`;
    if (!bloques.has(clave)) bloques.set(clave, []);
    bloques.get(clave).push(caso);
  }

  const ordenados = [...bloques.entries()]
    .map(([clave, lista]) => ({
      clave,
      lista: lista.sort((a, b) => numConsecutivo(a.consecutivo) - numConsecutivo(b.consecutivo)),
    }))
    .sort((a, b) => b.lista.length - a.lista.length);

  for (const bloque of ordenados) {
    let pendientes = bloque.lista;
    while (pendientes.length) {
      const libres = estado.filter((e) => e.cupo - e.asignados.length > 0);
      // Prioriza a quien ya lleva esta ciudad; luego a quien tenga más cupo libre.
      libres.sort((a, b) => {
        const tieneA = a.ciudades.has(bloque.clave) ? 1 : 0;
        const tieneB = b.ciudades.has(bloque.clave) ? 1 : 0;
        if (tieneA !== tieneB) return tieneB - tieneA;
        return b.cupo - b.asignados.length - (a.cupo - a.asignados.length);
      });
      const destino = libres[0];
      const espacio = destino.cupo - destino.asignados.length;
      const lote = pendientes.slice(0, espacio);
      for (const caso of lote) destino.asignados.push(caso);
      destino.ciudades.add(bloque.clave);
      pendientes = pendientes.slice(espacio);
    }
  }

  return estado;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 20000,
  });
  const db = mongoose.connection.db;

  const usuarios = await db
    .collection(COL_USUARIOS)
    .find({ active: { $ne: 'N' }, $or: [{ role: 'contractor_era' }, { empresa: /^era$/i }] })
    .project({ name: 1, login: 1, cedula: 1, email: 1, phone: 1 })
    .sort({ name: 1 })
    .toArray();

  const personas = usuarios
    .filter((u) => String(u.login).trim() !== LOGIN_LIDER_ERA)
    .map((u) => ({
      login: String(u.login).trim(),
      nombre: nombreSinSufijoRol(u.name),
      email: u.email || '',
      telefono: u.phone || '',
    }));

  const lider = usuarios.find((u) => String(u.login).trim() === LOGIN_LIDER_ERA);
  if (!lider) throw new Error('No se encontró al líder ERA (login 4201038754011).');
  if (personas.length !== 10) {
    throw new Error(`Se esperaban 10 ajustadores ERA (sin el líder) y hay ${personas.length}.`);
  }

  const nombresEra = new Set([...personas, { nombre: nombreSinSufijoRol(lider.name) }].map((p) => norm(p.nombre)));

  const catalogos = [];
  for (const persona of personas) {
    const aj = await asegurarCatalogo(db.collection(COL_AJUSTADORES), persona, 'AJU');
    const ins = await asegurarCatalogo(db.collection(COL_INSPECTORES), persona, 'INS');
    catalogos.push({ nombre: persona.nombre, ajustador: aj, inspector: ins });
  }

  const filtro = {
    fechaEmailConvenioMexico: { $exists: true, $ne: null },
    excluidoBaseAlfa: { $ne: true },
  };
  const casos = await db
    .collection(COL_CASOS)
    .find(filtro)
    .project({
      consecutivo: 1,
      siniestro: 1,
      ciudad: 1,
      departamento: 1,
      estado: 1,
      ajustador: 1,
      inspector: 1,
      ajustadorProserPrevio: 1,
      inspectorProserPrevio: 1,
      firmaAjuste: 1,
    })
    .toArray();

  if (!casos.length) throw new Error('No se encontraron casos con el correo del convenio México.');

  const reparto = repartirPorCiudad(casos, personas);

  const ops = [];
  for (const { persona, asignados } of reparto) {
    for (const caso of asignados) {
      const set = {
        ajustador: persona.nombre,
        inspector: persona.nombre,
        firmaAjuste: FIRMA,
        fechaAsignacionFirmaEra: new Date(),
        updatedAt: new Date(),
      };
      // Respaldo del equipo Proser: solo la primera vez y solo si venía de Proser.
      if (vacio(caso.ajustadorProserPrevio) && !vacio(caso.ajustador) && !esNombreEra(caso.ajustador, nombresEra)) {
        set.ajustadorProserPrevio = String(caso.ajustador).trim();
      }
      if (vacio(caso.inspectorProserPrevio) && !vacio(caso.inspector) && !esNombreEra(caso.inspector, nombresEra)) {
        set.inspectorProserPrevio = String(caso.inspector).trim();
      }
      ops.push({ updateOne: { filter: { _id: caso._id }, update: { $set: set } } });
    }
  }

  const resumen = reparto.map(({ persona, asignados, ciudades }) => ({
    ajustador: persona.nombre,
    login: persona.login,
    casos: asignados.length,
    ciudades: ciudades.size,
    ejemplos: asignados.slice(0, 3).map((c) => `${c.consecutivo} · ${c.ciudad || 's/ciudad'}`),
  }));

  const cambiosSobreProser = ops.filter((o) => o.updateOne.update.$set.ajustadorProserPrevio).length;

  console.log(
    JSON.stringify(
      {
        modo: APLICAR ? 'APLICAR' : 'DRY-RUN',
        liderSinCasos: `${nombreSinSufijoRol(lider.name)} (${LOGIN_LIDER_ERA})`,
        totalCasos: casos.length,
        ajustadoresEra: personas.length,
        casosQueVeníanDeProser: cambiosSobreProser,
        catalogos,
        reparto: resumen,
      },
      null,
      2
    )
  );

  if (!APLICAR) {
    console.log('\nDry-run: no se escribió nada. Para aplicar: node scripts/asignarCasosEraAlfa.js --apply');
    await mongoose.disconnect();
    return;
  }

  let modificados = 0;
  for (let i = 0; i < ops.length; i += 200) {
    const lote = ops.slice(i, i + 200);
    const r = await db.collection(COL_CASOS).bulkWrite(lote, { ordered: false });
    modificados += r.modifiedCount || 0;
  }

  const verificacion = await db
    .collection(COL_CASOS)
    .aggregate([
      { $match: { ...filtro, firmaAjuste: FIRMA } },
      { $group: { _id: '$ajustador', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();

  const logPath = path.join(__dirname, `../logs/asignacion_era_alfa_${Date.now()}.json`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(
    logPath,
    JSON.stringify(
      {
        fecha: new Date().toISOString(),
        totalCasos: casos.length,
        modificados,
        reparto: reparto.map(({ persona, asignados }) => ({
          ajustador: persona.nombre,
          login: persona.login,
          consecutivos: asignados.map((c) => c.consecutivo),
        })),
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(
    JSON.stringify({ modificados, verificacionPorAjustador: verificacion, log: logPath }, null, 2)
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
