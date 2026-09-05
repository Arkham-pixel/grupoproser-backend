/**
 * Reasigna casos Seguros Alfa de Jose Angel Flores Mena a Blanca Estela Rivera Diaz.
 * Jose se fue; Blanca toma sus casos (ajustador e inspector cuando coincidan).
 *
 * Uso:
 *   node scripts/reasignarJoseBlancaAlfa.js            # dry-run
 *   node scripts/reasignarJoseBlancaAlfa.js --apply
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

const JOSE_LOGIN = '2372119921487';
const BLANCA_LOGIN = '0186050007215';

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

function esJose(valor) {
  const n = norm(valor);
  if (!n) return false;
  if (n.includes('2372119921487')) return true;
  if (n.includes('jose') && n.includes('angel') && (n.includes('flores') || n.includes('flres')) && n.includes('mena')) {
    return true;
  }
  return false;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 20000,
  });
  const db = mongoose.connection.db;

  const [jose, blanca] = await Promise.all([
    db.collection(COL_USUARIOS).findOne({
      $or: [{ login: JOSE_LOGIN }, { cedula: JOSE_LOGIN }],
    }),
    db.collection(COL_USUARIOS).findOne({
      $or: [{ login: BLANCA_LOGIN }, { cedula: BLANCA_LOGIN }],
    }),
  ]);

  if (!jose) throw new Error('No se encontró a Jose Angel Flores Mena (login 2372119921487).');
  if (!blanca) throw new Error('No se encontró a Blanca Estela Rivera Diaz (login 0186050007215).');

  const nombreBlancaCatalogo =
    (await db.collection(COL_AJUSTADORES).findOne({
      $or: [
        { codigo: `AJU-ERA-${BLANCA_LOGIN}` },
        { nombre: /blanca\s+estela\s+rivera/i },
      ],
    }))?.nombre || nombreSinSufijo(blanca.name);

  const destino = String(nombreBlancaCatalogo).trim();

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

  const aCambiar = casos.filter((c) => esJose(c.ajustador) || esJose(c.inspector));

  const muestras = aCambiar.slice(0, 15).map((c) => ({
    consecutivo: c.consecutivo,
    siniestro: c.siniestro,
    estado: c.estado,
    ciudad: c.ciudad,
    de: { ajustador: c.ajustador, inspector: c.inspector },
  }));

  const nombresJose = [...new Set(aCambiar.flatMap((c) => [c.ajustador, c.inspector]).filter(esJose))];

  console.log(
    JSON.stringify(
      {
        modo: APLICAR ? 'APPLY' : 'DRY-RUN',
        jose: { login: jose.login, name: jose.name, active: jose.active },
        blanca: { login: blanca.login, name: blanca.name, active: blanca.active },
        destino,
        casosJose: aCambiar.length,
        nombresEnCasos: nombresJose,
        muestras,
      },
      null,
      2
    )
  );

  if (!aCambiar.length) {
    console.log('No hay casos Alfa de Jose para reasignar.');
    await mongoose.disconnect();
    return;
  }

  if (!APLICAR) {
    console.log('\nPara aplicar: node scripts/reasignarJoseBlancaAlfa.js --apply');
    await mongoose.disconnect();
    return;
  }

  let modifiedAj = 0;
  let modifiedIn = 0;
  const ops = [];
  for (const c of aCambiar) {
    const set = { updatedAt: new Date() };
    if (esJose(c.ajustador)) {
      set.ajustador = destino;
      modifiedAj += 1;
    }
    if (esJose(c.inspector)) {
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
  const quedanJose = post.filter((c) => esJose(c.ajustador) || esJose(c.inspector)).length;
  const destNorm = norm(destino);
  const totalBlanca = post.filter(
    (c) => norm(c.ajustador) === destNorm || norm(c.inspector) === destNorm
  ).length;

  await db.collection(COL_AJUSTADORES).updateOne(
    { $or: [{ codigo: `AJU-ERA-${BLANCA_LOGIN}` }, { nombre: new RegExp(`^${destino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }] },
    { $addToSet: { modulos: 'alfa' }, $set: { updatedAt: new Date() } }
  );
  await db.collection(COL_INSPECTORES).updateOne(
    { $or: [{ codigo: `INS-ERA-${BLANCA_LOGIN}` }, { nombre: new RegExp(`^${destino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }] },
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
        quedanJose,
        totalBlancaTrasUpdate: totalBlanca,
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
