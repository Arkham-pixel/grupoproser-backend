/**
 * Reasigna casos Seguros Alfa de Guillermo Harvey Muñoz Peña a Santiago Beltrán.
 * Solo colección Alfa. No toca a Guillermo Segundo Mangonez.
 *
 * Uso:
 *   node scripts/reasignarGuillermoSantiagoAlfa.js            # dry-run
 *   node scripts/reasignarGuillermoSantiagoAlfa.js --apply
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

const APLICAR = process.argv.includes('--apply');
const COL_CASOS = 'gsk3cAppsegurosAlfaCasos';
const COL_USUARIOS = 'securUsers';
const COL_AJUSTADORES = 'gsk3cAppajustadorcatastrofico';
const COL_INSPECTORES = 'gsk3cAppinspectorcatastrofico';

const ORIGEN_LOGIN = '4617592'; // Guillermo Harvey Muñoz Peña
const DESTINO_LOGIN = '1019139118'; // Santiago Beltrán

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\((?:era|alfa|zurich|sura|bbva)\)\s*$/i, '')
    .trim();
}

function nombreSinSufijo(nombre) {
  return String(nombre || '')
    .replace(/\s*\((?:ERA|Alfa|Zurich|Sura|BBVA)\)\s*$/i, '')
    .trim();
}

/** Solo Harvey Muñoz Peña — excluye Guillermo Segundo Mangonez y otros Guillermos. */
function esGuillermoHarvey(valor) {
  const n = norm(valor);
  if (!n) return false;
  if (n.includes(ORIGEN_LOGIN) || n.includes(`aju-${ORIGEN_LOGIN}`) || n.includes(`ins-${ORIGEN_LOGIN}`)) {
    return true;
  }
  if (n.includes('mangonez') || n.includes('segundo')) return false;
  const tieneGuillermo = n.includes('guillermo');
  const tieneHarvey = n.includes('harvey');
  const tieneMunoz = n.includes('munoz');
  if (tieneGuillermo && tieneHarvey) return true;
  if (tieneHarvey && tieneMunoz) return true;
  if (tieneGuillermo && tieneMunoz && n.includes('pena')) return true;
  return false;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 20000,
  });
  const db = mongoose.connection.db;

  const [origen, destinoUser] = await Promise.all([
    db.collection(COL_USUARIOS).findOne({
      $or: [{ login: ORIGEN_LOGIN }, { cedula: ORIGEN_LOGIN }],
    }),
    db.collection(COL_USUARIOS).findOne({
      $or: [{ login: DESTINO_LOGIN }, { cedula: DESTINO_LOGIN }],
    }),
  ]);

  if (!origen || !/HARVEY|MU[NÑ]OZ/i.test(origen.name || '')) {
    throw new Error(`No se encontró a Guillermo Harvey Muñoz Peña (login ${ORIGEN_LOGIN}).`);
  }
  if (!destinoUser) {
    throw new Error(`No se encontró a Santiago Beltrán (login ${DESTINO_LOGIN}).`);
  }

  const nombreDestinoCatalogo =
    (
      await db.collection(COL_AJUSTADORES).findOne({
        $or: [
          { codigo: `AJU-${DESTINO_LOGIN}` },
          { codigo: `AJU-ERA-${DESTINO_LOGIN}` },
          { nombre: /santiago\s+beltr[aá]n/i },
        ],
      })
    )?.nombre || nombreSinSufijo(destinoUser.name);

  const destino = String(nombreDestinoCatalogo).trim();

  const casos = await db
    .collection(COL_CASOS)
    .find({ excluidoBaseAlfa: { $ne: true } })
    .project({
      consecutivo: 1,
      siniestro: 1,
      asegurado: 1,
      estado: 1,
      ciudad: 1,
      departamento: 1,
      ajustador: 1,
      inspector: 1,
      ajustadorLider: 1,
      firmaAjuste: 1,
    })
    .toArray();

  const aCambiar = casos.filter(
    (c) =>
      esGuillermoHarvey(c.ajustador) ||
      esGuillermoHarvey(c.inspector) ||
      esGuillermoHarvey(c.ajustadorLider)
  );

  const muestras = aCambiar.slice(0, 20).map((c) => ({
    consecutivo: c.consecutivo,
    siniestro: c.siniestro,
    estado: c.estado,
    ciudad: c.ciudad,
    de: {
      ajustador: c.ajustador,
      inspector: c.inspector,
      ajustadorLider: c.ajustadorLider,
    },
  }));

  const nombresOrigen = [
    ...new Set(
      aCambiar
        .flatMap((c) => [c.ajustador, c.inspector, c.ajustadorLider])
        .filter(esGuillermoHarvey)
    ),
  ];

  console.log(
    JSON.stringify(
      {
        modo: APLICAR ? 'APPLY' : 'DRY-RUN',
        origen: { login: origen.login, name: origen.name, active: origen.active },
        destinoUser: {
          login: destinoUser.login,
          name: destinoUser.name,
          active: destinoUser.active,
        },
        destino,
        casosOrigen: aCambiar.length,
        nombresEnCasos: nombresOrigen,
        muestras,
      },
      null,
      2
    )
  );

  if (!aCambiar.length) {
    console.log('No hay casos Alfa de Guillermo Harvey para reasignar.');
    await mongoose.disconnect();
    return;
  }

  if (!APLICAR) {
    console.log('\nPara aplicar: node scripts/reasignarGuillermoSantiagoAlfa.js --apply');
    await mongoose.disconnect();
    return;
  }

  let modifiedAj = 0;
  let modifiedIn = 0;
  let modifiedLid = 0;
  const ops = [];
  for (const c of aCambiar) {
    const set = { updatedAt: new Date() };
    if (esGuillermoHarvey(c.ajustador)) {
      set.ajustador = destino;
      modifiedAj += 1;
    }
    if (esGuillermoHarvey(c.inspector)) {
      set.inspector = destino;
      modifiedIn += 1;
    }
    if (esGuillermoHarvey(c.ajustadorLider)) {
      set.ajustadorLider = destino;
      modifiedLid += 1;
    }
    ops.push({
      updateOne: {
        filter: { _id: c._id },
        update: { $set: set },
      },
    });
  }

  const result = await db.collection(COL_CASOS).bulkWrite(ops, { ordered: false });

  const post = await db
    .collection(COL_CASOS)
    .find({ excluidoBaseAlfa: { $ne: true } })
    .project({ ajustador: 1, inspector: 1, ajustadorLider: 1 })
    .toArray();
  const quedanOrigen = post.filter(
    (c) =>
      esGuillermoHarvey(c.ajustador) ||
      esGuillermoHarvey(c.inspector) ||
      esGuillermoHarvey(c.ajustadorLider)
  ).length;
  const destNorm = norm(destino);
  const totalDestino = post.filter(
    (c) =>
      norm(c.ajustador) === destNorm ||
      norm(c.inspector) === destNorm ||
      norm(c.ajustadorLider) === destNorm
  ).length;

  const escDest = destino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await db.collection(COL_AJUSTADORES).updateOne(
    {
      $or: [
        { codigo: `AJU-${DESTINO_LOGIN}` },
        { codigo: `AJU-ERA-${DESTINO_LOGIN}` },
        { nombre: new RegExp(`^${escDest}$`, 'i') },
      ],
    },
    { $addToSet: { modulos: 'alfa' }, $set: { updatedAt: new Date() } }
  );
  await db.collection(COL_INSPECTORES).updateOne(
    {
      $or: [
        { codigo: `INS-${DESTINO_LOGIN}` },
        { codigo: `INS-ERA-${DESTINO_LOGIN}` },
        { nombre: new RegExp(`^${escDest}$`, 'i') },
      ],
    },
    { $addToSet: { modulos: 'alfa' }, $set: { updatedAt: new Date() } }
  );

  console.log('\n========== APLICADO ==========');
  console.log(
    JSON.stringify(
      {
        matched: result.matchedCount,
        modified: result.modifiedCount,
        camposAjustador: modifiedAj,
        camposInspector: modifiedIn,
        camposAjustadorLider: modifiedLid,
        quedanOrigen,
        totalDestinoTrasUpdate: totalDestino,
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
