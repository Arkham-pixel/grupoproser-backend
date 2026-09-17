/**
 * Sincroniza ajustadores e inspectores BBVA CAT con el listado oficial del equipo.
 * Miguel Andrés Báez queda como ajustador líder (responsables), no como campo.
 *
 * Uso: node scripts/sincronizar_equipo_bbva_cat_oficial.js
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

/** Campo (ajustador + inspector). Sin Miguel (líder). */
const EQUIPO_CAMPO = [
  {
    nombre: 'Jairo Sadoc Puentes Morales',
    profesion: 'INGENIERO CIVIL',
    cedula: '79754443',
    email: 'sadoc85@gmail.com',
    telefono: '3134404339',
    ciudad: 'Bogotá',
  },
  {
    nombre: 'Jorge Enrique Salazar Gonzalez',
    profesion: 'ARQUITECTO',
    cedula: '19304748',
    email: 'jorgekike1211@gmail.com',
    telefono: '3144742125',
    ciudad: 'Bogotá',
  },
  {
    nombre: 'Douglas Santiago Puentes Cantor',
    profesion: 'INGENIERO CIVIL',
    cedula: '1032488802',
    email: 'douglassantiago0710@gmail.com',
    telefono: '3172483325',
    ciudad: 'Soacha',
  },
  {
    nombre: 'Ayfa Briced Herrera Merchan',
    profesion: 'ARQUITECTO',
    cedula: '52478912',
    email: 'ayfabh@gmail.com',
    telefono: '3208200213',
    ciudad: 'Soacha',
  },
  {
    nombre: 'Javier Orlando Ramirez Rodriguez',
    profesion: 'ARQUITECTO',
    cedula: '79655067',
    email: 'javierramirezrodriguez73@gmail.com',
    telefono: '3208591353',
    ciudad: 'Bogotá',
  },
  {
    nombre: 'Oscar Villanueva Arias',
    profesion: 'ARQUITECTO',
    cedula: '14231484',
    email: 'ovillanuevarq2025@gmail.com',
    telefono: '3208999013',
    ciudad: 'Bogotá',
  },
  {
    nombre: 'Sebastian Alejandro Castro Gil',
    profesion: 'INGENIERO CIVIL',
    cedula: '1001826133',
    email: 'scastroingeniero@gmail.com',
    telefono: '3214616740',
    ciudad: 'Barranquilla',
  },
  {
    nombre: 'Omar Rodolfo Pico Quintero',
    profesion: 'INGENIERO CIVIL',
    cedula: '91180692',
    email: 'omarpicoingenieria@hotmail.com',
    telefono: '3162344057',
    ciudad: 'Bucaramanga',
  },
  {
    nombre: 'Yury Carolina Morantes',
    profesion: 'INGENIERO CIVIL',
    cedula: '1083433781',
    email: 'ing.karom22@gmail.com',
    telefono: '3016386139',
    ciudad: 'Barranquilla',
  },
  {
    nombre: 'Juan Camilo Pardo Mesa',
    profesion: 'ARQUITECTO',
    cedula: '1095800166',
    email: 'juankpm.arq@gmail.com',
    telefono: '14038269994',
    ciudad: 'Bogotá',
  },
  {
    nombre: 'Karla Andrea Parada Rocha',
    profesion: 'INGENIERO CIVIL',
    cedula: '1041900044',
    email: 'Karlap1226@hotmail.com',
    telefono: '3016147958',
    ciudad: 'Barranquilla',
  },
  {
    nombre: 'Marisol Gómez Carreño',
    profesion: 'INGENIERO CIVIL',
    cedula: '1140829990',
    email: 'Marisolgmz15@gmail.com',
    telefono: '3239652220',
    ciudad: 'Barranquilla',
  },
  {
    nombre: 'Adriel Jose Escorcia Pulgar',
    profesion: 'INGENIERO CIVIL',
    cedula: '1002500141',
    email: 'adrielescorciap@gmail.com',
    telefono: '3005555870',
    ciudad: 'Cartagena',
  },
  {
    nombre: 'Moisés Felipe Fernández Valencia',
    profesion: 'AJUSTADOR',
    cedula: '25347049',
    email: 'm.f.fernandezvalencia@gmail.com',
    telefono: '3114064294',
    ciudad: 'Todas',
  },
];

const LIDER = {
  nombre: 'Miguel Andrés Báez Zuluaga',
  cedula: '80187828',
  email: 'miguelandresbaez@gmail.com',
  telefono: '3006347645',
  ciudad: 'Bogotá',
};

function norm(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[.\s-]/g, '')
    .trim()
    .toUpperCase();
}

async function upsertCatalogo(col, persona, prefijo) {
  const codigo = `${prefijo}-${persona.cedula}`;
  const nombreNorm = norm(persona.nombre);
  const candidatos = await col
    .find({})
    .project({ codigo: 1, nombre: 1 })
    .toArray();
  const hit = candidatos.find(
    (e) => String(e.codigo || '').trim() === codigo || norm(e.nombre) === nombreNorm
  );
  const doc = hit ? await col.findOne({ _id: hit._id }) : null;

  const payload = {
    codigo: doc?.codigo || codigo,
    nombre: persona.nombre,
    email: persona.email || '',
    telefono: String(persona.telefono || '').replace(/\D/g, ''),
    ciudad: persona.ciudad || 'Todas',
    updatedAt: new Date(),
  };

  if (doc) {
    await col.updateOne(
      { _id: doc._id },
      { $set: payload, $addToSet: { modulos: 'bbvaCat' } }
    );
    return { estado: 'ACTUALIZADO', codigo: payload.codigo, nombre: payload.nombre };
  }

  await col.insertOne({
    ...payload,
    modulos: ['bbvaCat'],
    createdAt: new Date(),
  });
  return { estado: 'CREADO', codigo: payload.codigo, nombre: payload.nombre };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  const db = mongoose.connection.db;
  const colAj = db.collection('gsk3cAppajustadorcatastrofico');
  const colIns = db.collection('gsk3cAppinspectorcatastrofico');
  const colResp = db.collection('gsk3cAppresponsable');

  const ajuRes = [];
  const insRes = [];
  const codigosAju = [];
  const codigosIns = [];

  for (const persona of EQUIPO_CAMPO) {
    const aj = await upsertCatalogo(colAj, persona, 'AJU');
    const ins = await upsertCatalogo(colIns, persona, 'INS');
    ajuRes.push(aj);
    insRes.push(ins);
    codigosAju.push(aj.codigo);
    codigosIns.push(ins.codigo);
  }

  const ajuQuit = await colAj.updateMany(
    { codigo: { $nin: codigosAju }, modulos: 'bbvaCat' },
    { $pull: { modulos: 'bbvaCat' }, $set: { updatedAt: new Date() } }
  );
  const insQuit = await colIns.updateMany(
    { codigo: { $nin: codigosIns }, modulos: 'bbvaCat' },
    { $pull: { modulos: 'bbvaCat' }, $set: { updatedAt: new Date() } }
  );

  const liderExistente = await colResp.findOne({
    $or: [
      { nmbrRespnsble: /miguel\s+andres\s+b[aá]ez/i },
      { nmbrRespnsble: /miguel\s+b[aá]ez/i },
      { codiRespnsble: 'MIGUEL-BAEZ' },
      { codiRespnsble: LIDER.cedula },
    ],
  });

  if (liderExistente) {
    await colResp.updateOne(
      { _id: liderExistente._id },
      {
        $set: {
          nmbrRespnsble: LIDER.nombre,
          email: LIDER.email,
          telefono: LIDER.telefono,
          updatedAt: new Date(),
        },
      }
    );
  } else {
    await colResp.insertOne({
      codiRespnsble: 'MIGUEL-BAEZ',
      nmbrRespnsble: LIDER.nombre,
      email: LIDER.email,
      telefono: LIDER.telefono,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const ajustadores = await colAj
    .find({ modulos: 'bbvaCat' })
    .project({ codigo: 1, nombre: 1, ciudad: 1, email: 1 })
    .sort({ nombre: 1 })
    .toArray();
  const inspectores = await colIns
    .find({ modulos: 'bbvaCat' })
    .project({ codigo: 1, nombre: 1, ciudad: 1, email: 1 })
    .sort({ nombre: 1 })
    .toArray();

  console.log(
    JSON.stringify(
      {
        campo: EQUIPO_CAMPO.length,
        lider: LIDER.nombre,
        ajustadoresUpsert: ajuRes.length,
        inspectoresUpsert: insRes.length,
        ajustadoresBbvaQuitados: ajuQuit.modifiedCount,
        inspectoresBbvaQuitados: insQuit.modifiedCount,
        ajustadoresBbva: ajustadores.map((a) => ({
          codigo: a.codigo,
          nombre: a.nombre,
          ciudad: a.ciudad,
        })),
        inspectoresBbva: inspectores.map((a) => ({
          codigo: a.codigo,
          nombre: a.nombre,
          ciudad: a.ciudad,
        })),
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
