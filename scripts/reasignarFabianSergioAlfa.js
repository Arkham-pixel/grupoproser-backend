/**
 * Reasigna casos Seguros Alfa:
 *   FABIAN BRAVO  → Valentina Collazos Diaz
 *   SERGIO DIAZ   → Guillermo Harvey Muñoz Peña
 *
 * Actualiza ajustador e inspector cuando coinciden con el origen.
 *
 * Uso:
 *   node scripts/reasignarFabianSergioAlfa.js              # dry-run
 *   DRY_RUN=false node scripts/reasignarFabianSergioAlfa.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const DRY = String(process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

const MAPEO = [
  {
    desdeAlias: 'Fabian Bravo',
    hacia: 'Valentina Collazos Diaz',
    match: [/fabian\s+bravo/i],
  },
  {
    desdeAlias: 'Sergio Diaz',
    hacia: 'Guillermo Harvey Muñoz Peña',
    match: [/^sergio\s+diaz$/i, /sergio\s+diaz/i],
  },
];

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function coincide(valor, regexes) {
  const n = norm(valor);
  if (!n) return false;
  return regexes.some((re) => re.test(n) || re.test(String(valor || '')));
}

async function main() {
  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
  } else if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }

  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 20000,
  });
  const col = mongoose.connection.db.collection('gsk3cAppsegurosAlfaCasos');

  // Nombres canónicos desde catálogo (si existen)
  const colAj = mongoose.connection.db.collection('gsk3cAppajustadorcatastrofico');
  for (const m of MAPEO) {
    const aj = await colAj.findOne({
      nombre: new RegExp(m.hacia.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    });
    if (aj?.nombre) m.hacia = String(aj.nombre).trim();
  }

  const resumen = [];

  for (const m of MAPEO) {
    const todos = await col
      .find({})
      .project({ consecutivo: 1, siniestro: 1, ajustador: 1, inspector: 1 })
      .toArray();

    const aCambiar = todos.filter(
      (c) => coincide(c.ajustador, m.match) || coincide(c.inspector, m.match)
    );

    let modifiedAj = 0;
    let modifiedIn = 0;
    const muestras = [];

    for (const c of aCambiar) {
      const set = { updatedAt: new Date() };
      let cambia = false;
      if (coincide(c.ajustador, m.match)) {
        set.ajustador = m.hacia;
        cambia = true;
        modifiedAj += 1;
      }
      if (coincide(c.inspector, m.match)) {
        set.inspector = m.hacia;
        cambia = true;
        modifiedIn += 1;
      }
      if (!cambia) continue;
      if (muestras.length < 8) {
        muestras.push({
          consecutivo: c.consecutivo,
          de: { ajustador: c.ajustador, inspector: c.inspector },
          a: {
            ajustador: set.ajustador ?? c.ajustador,
            inspector: set.inspector ?? c.inspector,
          },
        });
      }
      if (!DRY) {
        await col.updateOne({ _id: c._id }, { $set: set });
      }
    }

    // Conteos post
    let quedanOrigen = 0;
    let totalDestino = 0;
    if (!DRY) {
      const post = await col
        .find({})
        .project({ ajustador: 1, inspector: 1 })
        .toArray();
      quedanOrigen = post.filter(
        (c) => coincide(c.ajustador, m.match) || coincide(c.inspector, m.match)
      ).length;
      const destRe = new RegExp(
        m.hacia.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i'
      );
      totalDestino = post.filter(
        (c) => destRe.test(String(c.ajustador || '')) || destRe.test(String(c.inspector || ''))
      ).length;
    }

    resumen.push({
      desde: m.desdeAlias,
      hacia: m.hacia,
      casosAfectados: aCambiar.length,
      camposAjustador: modifiedAj,
      camposInspector: modifiedIn,
      muestras,
      quedanOrigenTrasUpdate: DRY ? '(dry-run)' : quedanOrigen,
      totalConDestinoTrasUpdate: DRY ? '(dry-run)' : totalDestino,
    });

    console.log(
      `\n${DRY ? '[DRY-RUN] ' : ''}${m.desdeAlias} → ${m.hacia}: ${aCambiar.length} casos ` +
        `(ajustador×${modifiedAj}, inspector×${modifiedIn})`
    );
  }

  console.log('\n========== RESUMEN ==========');
  console.log(JSON.stringify(resumen, null, 2));
  if (DRY) {
    console.log('\nPara aplicar: DRY_RUN=false node scripts/reasignarFabianSergioAlfa.js');
  }

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
