/**
 * Pasa a COORDINANDO INSPECCIÓN solo los BBVA CAT que:
 *  - recibieron el correo masivo de videoperitaje, y
 *  - están hoy en CASO NUEVO.
 * No toca estados posteriores.
 *
 * Uso:
 *   node scripts/pasarCasoNuevoACoordinandoVideoperitajeBbva.js
 *   node scripts/pasarCasoNuevoACoordinandoVideoperitajeBbva.js --apply
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
const SENT_LOG = path.join(__dirname, '_log_videoperitaje_bbva_enviados.json');
const ESTADO_ORIGEN = 'CASO NUEVO';
const ESTADO_DESTINO = 'COORDINANDO INSPECCIÓN';

function parseArgs(argv) {
  return { apply: argv.includes('--apply') };
}

function normalizarEmail(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function extraerEmailsDeCampo(raw) {
  const text = String(raw || '');
  const found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(found.map(normalizarEmail).filter(Boolean))];
}

function cargarDestinatariosVideoperitaje() {
  const emails = new Set();
  const siniestros = new Set();

  if (fs.existsSync(SENT_LOG)) {
    const data = JSON.parse(fs.readFileSync(SENT_LOG, 'utf8'));
    for (const e of data.emails || []) {
      const email = normalizarEmail(e);
      if (email) emails.add(email);
    }
  }

  for (const name of fs.readdirSync(__dirname)) {
    if (!/^_log_videoperitaje_bbva_\d+\.json$/.test(name)) continue;
    const log = JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
    for (const row of log.ok || []) {
      const email = normalizarEmail(row.email);
      if (email) emails.add(email);
      for (const s of row.siniestros || []) {
        const sin = String(s || '').trim();
        if (sin) siniestros.add(sin);
      }
    }
  }

  return { emails, siniestros };
}

function esCasoNuevo(estado) {
  return homologarEstadoBbvaCat(estado) === ESTADO_ORIGEN;
}

function emailsDelCaso(doc) {
  const campos = [doc.correoAsegurado, doc.correo, doc.contactoAsegurado, doc.aseguradoContacto];
  const out = new Set();
  for (const c of campos) {
    for (const e of extraerEmailsDeCampo(c)) out.add(e);
  }
  return out;
}

function coincideDestinatario(doc, emails, siniestros) {
  const sin = String(doc.siniestro || doc.zc || '').trim();
  if (sin && siniestros.has(sin)) return true;
  for (const e of emailsDelCaso(doc)) {
    if (emails.has(e)) return true;
  }
  return false;
}

async function actualizarColeccion(Model, nombre, emails, siniestros, apply) {
  const candidatos = await Model.find({
    $or: [
      { estado: ESTADO_ORIGEN },
      { estado: { $regex: /^caso\s*nuevo$/i } },
    ],
  }).select('_id siniestro zc estado correoAsegurado correo contactoAsegurado aseguradoContacto fechaCoordinandoInspeccion');

  const ids = [];
  for (const doc of candidatos) {
    if (!esCasoNuevo(doc.estado)) continue;
    if (!coincideDestinatario(doc, emails, siniestros)) continue;
    ids.push(doc._id);
  }

  let modified = 0;
  if (apply && ids.length) {
    const ahora = new Date();
    const res = await Model.updateMany(
      { _id: { $in: ids }, estado: ESTADO_ORIGEN },
      {
        $set: {
          estado: ESTADO_DESTINO,
          fechaCoordinandoInspeccion: ahora,
          updatedAt: ahora,
        },
      }
    );
    modified = res.modifiedCount || 0;
  }

  return {
    coleccion: nombre,
    casoNuevoTotales: candidatos.length,
    coincidenVideoperitaje: ids.length,
    actualizados: apply ? modified : 0,
  };
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  const { emails, siniestros } = cargarDestinatariosVideoperitaje();

  if (!emails.size && !siniestros.size) {
    throw new Error('No hay log de videoperitaje BBVA (emails/siniestros).');
  }

  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);

  const [cat, listado] = await Promise.all([
    actualizarColeccion(BbvaCatCaso, 'BbvaCatCaso', emails, siniestros, apply),
    actualizarColeccion(BbvaCatListadoCaso, 'BbvaCatListadoCaso', emails, siniestros, apply),
  ]);

  console.log(
    JSON.stringify(
      {
        modo: apply ? 'APPLY' : 'DRY-RUN',
        destinatariosEmail: emails.size,
        destinatariosSiniestro: siniestros.size,
        cat,
        listado,
        nota: apply
          ? 'Solo CASO NUEVO → COORDINANDO INSPECCIÓN (destinatarios videoperitaje).'
          : 'Sin cambios. Pase --apply para escribir.',
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
