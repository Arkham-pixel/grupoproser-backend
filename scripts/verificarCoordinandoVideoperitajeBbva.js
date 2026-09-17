/**
 * Verifica cruce: correos videoperitaje BBVA vs estados actuales.
 *   node scripts/verificarCoordinandoVideoperitajeBbva.js
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';
import { homologarEstadoBbvaCat } from '../utils/estadosBbvaCat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function cargar() {
  const emails = new Set();
  const siniestros = new Set();
  const emailToSins = new Map();

  const sent = JSON.parse(
    fs.readFileSync(path.join(__dirname, '_log_videoperitaje_bbva_enviados.json'), 'utf8')
  );
  for (const e of sent.emails || []) emails.add(String(e).toLowerCase().trim());

  for (const name of fs.readdirSync(__dirname)) {
    if (!/^_log_videoperitaje_bbva_\d+\.json$/.test(name)) continue;
    const log = JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
    for (const row of log.ok || []) {
      const email = String(row.email || '')
        .toLowerCase()
        .trim();
      if (email) emails.add(email);
      if (!emailToSins.has(email)) emailToSins.set(email, new Set());
      for (const s of row.siniestros || []) {
        const sin = String(s || '').trim();
        if (!sin) continue;
        siniestros.add(sin);
        emailToSins.get(email).add(sin);
      }
    }
  }
  return { emails, siniestros, emailToSins };
}

function resumen(docs, siniestros, label) {
  const porEstado = {};
  const porSin = new Map();
  for (const d of docs) {
    const est = homologarEstadoBbvaCat(d.estado);
    porEstado[est] = (porEstado[est] || 0) + 1;
    const sin = String(d.siniestro || d.zc || '').trim();
    if (sin) porSin.set(sin, est);
  }
  const sinsConCaso = [...siniestros].filter((s) => porSin.has(s));
  const sinsSinCaso = [...siniestros].filter((s) => !porSin.has(s));
  const aunNuevo = [...siniestros].filter((s) => porSin.get(s) === 'CASO NUEVO');
  const coordinando = [...siniestros].filter((s) => porSin.get(s) === 'COORDINANDO INSPECCIÓN');
  const yaAvanzados = [...siniestros].filter((s) => {
    const e = porSin.get(s);
    return e && e !== 'CASO NUEVO' && e !== 'COORDINANDO INSPECCIÓN';
  });
  return {
    label,
    docsEncontrados: docs.length,
    siniestrosConCaso: sinsConCaso.length,
    siniestrosSinCasoEnDb: sinsSinCaso.length,
    enCoordinando: coordinando.length,
    aunCasoNuevo: aunNuevo.length,
    yaEstabanMasAdelante: yaAvanzados.length,
    porEstadoDocs: porEstado,
    sampleSinCaso: sinsSinCaso.slice(0, 12),
    sampleAunNuevo: aunNuevo.slice(0, 10),
    sampleAvanzados: yaAvanzados.slice(0, 8).map((s) => ({ siniestro: s, estado: porSin.get(s) })),
  };
}

async function main() {
  const { emails, siniestros, emailToSins } = cargar();
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);

  const filtro = {
    $or: [{ siniestro: { $in: [...siniestros] } }, { zc: { $in: [...siniestros] } }],
  };
  const select = 'siniestro zc estado';
  const [cats, listados] = await Promise.all([
    BbvaCatCaso.find(filtro).select(select).lean(),
    BbvaCatListadoCaso.find(filtro).select(select).lean(),
  ]);

  const catBySin = new Map(
    cats.map((c) => [String(c.siniestro || c.zc || '').trim(), homologarEstadoBbvaCat(c.estado)])
  );

  let emailsConCaso = 0;
  let emailsSinCaso = 0;
  let emailsSoloAvanzados = 0;
  let emailsConCoordinando = 0;
  let emailsAunNuevo = 0;
  for (const [, sins] of emailToSins) {
    const list = [...sins];
    if (!list.length) continue;
    const estados = list.map((s) => catBySin.get(s)).filter(Boolean);
    if (!estados.length) {
      emailsSinCaso += 1;
      continue;
    }
    emailsConCaso += 1;
    if (estados.some((e) => e === 'CASO NUEVO')) emailsAunNuevo += 1;
    if (estados.some((e) => e === 'COORDINANDO INSPECCIÓN')) emailsConCoordinando += 1;
    if (estados.every((e) => e !== 'CASO NUEVO' && e !== 'COORDINANDO INSPECCIÓN')) {
      emailsSoloAvanzados += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        correosEnviadosUnicos: emails.size,
        siniestrosEnLogsOk: siniestros.size,
        emailsConSiniestroEnLogs: emailToSins.size,
        emailsConAlgúnCasoEnCat: emailsConCaso,
        emailsSinCasoEnCat: emailsSinCaso,
        emailsConAlgunCoordinando: emailsConCoordinando,
        emailsAunConCasoNuevo: emailsAunNuevo,
        emailsSoloEstadosMasAdelante: emailsSoloAvanzados,
        cat: resumen(cats, siniestros, 'CAT'),
        listado: resumen(listados, siniestros, 'LISTADO'),
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
