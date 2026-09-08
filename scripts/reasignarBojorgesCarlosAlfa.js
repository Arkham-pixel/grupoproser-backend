/**
 * Reasigna casos Seguros Alfa de Miguel Angel Bojorges Mendez
 * a Carlos Eduardo Luz Contreras.
 *
 * Uso:
 *   node scripts/reasignarBojorgesCarlosAlfa.js            # dry-run
 *   node scripts/reasignarBojorgesCarlosAlfa.js --apply
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

const ORIGEN_LOGIN = '1997082904240'; // Miguel Angel Bojorges Mendez
const DESTINO_LOGIN = '5346081408584'; // Carlos Eduardo Luz Contreras

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

function esBojorges(valor) {
  const n = norm(valor);
  if (!n) return false;
  if (n.includes(ORIGEN_LOGIN)) return true;
  // Miguel Angel Bojorges / Bojorge (variantes de apellido)
  if (
    n.includes('miguel') &&
    n.includes('angel') &&
    (n.includes('bojorges') || n.includes('bojorge'))
  ) {
    return true;
  }
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

  if (!origen) {
    throw new Error(`No se encontró a Miguel Angel Bojorges (login ${ORIGEN_LOGIN}).`);
  }
  if (!destinoUser) {
    throw new Error(`No se encontró a Carlos Eduardo Luz Contreras (login ${DESTINO_LOGIN}).`);
  }

  const nombreDestinoCatalogo =
    (
      await db.collection(COL_AJUSTADORES).findOne({
        $or: [
          { codigo: `AJU-ERA-${DESTINO_LOGIN}` },
          { nombre: /carlos\s+eduardo\s+luz/i },
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
      firmaAjuste: 1,
    })
    .toArray();

  const aCambiar = casos.filter((c) => esBojorges(c.ajustador) || esBojorges(c.inspector));

  const muestras = aCambiar.slice(0, 15).map((c) => ({
    consecutivo: c.consecutivo,
    siniestro: c.siniestro,
    estado: c.estado,
    ciudad: c.ciudad,
    de: { ajustador: c.ajustador, inspector: c.inspector },
  }));

  const nombresOrigen = [
    ...new Set(aCambiar.flatMap((c) => [c.ajustador, c.inspector]).filter(esBojorges)),
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
    console.log('No hay casos Alfa de Bojorges para reasignar.');
    await mongoose.disconnect();
    return;
  }

  if (!APLICAR) {
    console.log('\nPara aplicar: node scripts/reasignarBojorgesCarlosAlfa.js --apply');
    await mongoose.disconnect();
    return;
  }

  let modifiedAj = 0;
  let modifiedIn = 0;
  const ops = [];
  for (const c of aCambiar) {
    const set = { updatedAt: new Date() };
    if (esBojorges(c.ajustador)) {
      set.ajustador = destino;
      modifiedAj += 1;
    }
    if (esBojorges(c.inspector)) {
      set.inspector = destino;
      modifiedIn += 1;
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
    .project({ ajustador: 1, inspector: 1 })
    .toArray();
  const quedanOrigen = post.filter((c) => esBojorges(c.ajustador) || esBojorges(c.inspector)).length;
  const destNorm = norm(destino);
  const totalDestino = post.filter(
    (c) => norm(c.ajustador) === destNorm || norm(c.inspector) === destNorm
  ).length;

  await db.collection(COL_AJUSTADORES).updateOne(
    {
      $or: [
        { codigo: `AJU-ERA-${DESTINO_LOGIN}` },
        {
          nombre: new RegExp(`^${destino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        },
      ],
    },
    { $addToSet: { modulos: 'alfa' }, $set: { updatedAt: new Date() } }
  );
  await db.collection(COL_INSPECTORES).updateOne(
    {
      $or: [
        { codigo: `INS-ERA-${DESTINO_LOGIN}` },
        {
          nombre: new RegExp(`^${destino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        },
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
