/**
 * Busca rastros recuperables del control de horas en BD, outbox de correos y uploads.
 *
 * Uso:
 *   node scripts/buscarControlHorasPerdido.js 6a1848e41570d870fe97a147
 *   node scripts/buscarControlHorasPerdido.js INC-25334
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { controlHorasTieneDatos } from '../utils/controlHorasUtils.js';

const MONGO_URI = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.resolve(__dirname, '../uploads');

const arg = process.argv[2] || '6a1848e41570d870fe97a147';

async function buscarCaso(col) {
  if (mongoose.Types.ObjectId.isValid(arg)) {
    return col.findOne({ _id: new mongoose.Types.ObjectId(arg) });
  }
  const regex = new RegExp(arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return col.findOne({
    $or: [{ nmroAjste: regex }, { nmroSinstro: regex }, { nmroPolza: regex }],
  });
}

function recorrerUploads(dir, terminos, resultados = [], profundidad = 0) {
  if (profundidad > 8 || !fs.existsSync(dir)) return resultados;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return resultados;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      recorrerUploads(full, terminos, resultados, profundidad + 1);
      continue;
    }
    const nombre = e.name.toLowerCase();
    const hit = terminos.some((t) => t && nombre.includes(String(t).toLowerCase()));
    if (hit || /control.*hora|hora.*control/i.test(nombre)) {
      resultados.push(full);
    }
  }
  return resultados;
}

async function buscarEnColecciones(db, caso) {
  const terminos = [
    caso._id?.toString(),
    caso.nmroAjste,
    caso.nmroSinstro,
    'INC-25334',
    '20233385',
    'Martha',
    'CABRERA',
  ].filter(Boolean);

  const hits = [];
  const colecciones = await db.listCollections().toArray();

  for (const { name } of colecciones) {
    if (name.startsWith('system.')) continue;
    const col = db.collection(name);
    let docs = [];
    try {
      docs = await col
        .find({
          $or: [
            { 'control_horas.filas.0': { $exists: true } },
            { 'controlHoras.filas.0': { $exists: true } },
            { 'datos.control_horas.filas.0': { $exists: true } },
          ],
          $and: [
            {
              $or: terminos.flatMap((t) => [
                { numeroCaso: t },
                { nmroAjste: t },
                { nmroSinstro: t },
                { casoId: t },
                { numeroCaso: new RegExp(t, 'i') },
                { nmroAjste: new RegExp(t, 'i') },
                { nmroSinstro: new RegExp(t, 'i') },
                { titulo: new RegExp(t, 'i') },
                { 'meta.numeroCaso': t },
                { 'meta.casoId': t },
              ]),
            },
          ],
        })
        .limit(5)
        .toArray();
    } catch {
      continue;
    }

    if (docs.length) {
      hits.push({ coleccion: name, count: docs.length, ids: docs.map((d) => d._id) });
    }
  }

  return hits;
}

async function buscarEmailOutbox(db, caso) {
  const colecciones = (await db.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => /outbox|email/i.test(n));

  const resultados = [];
  for (const nombre of colecciones) {
    const col = db.collection(nombre);
    const docs = await col
      .find({
        $or: [
          { tipo: 'control_horas' },
          { 'meta.tipo': 'control_horas' },
          { 'mailOptions.subject': /control de horas/i },
        ],
        $or: [
          { 'mailOptions.html': /2026-05-20233385|INC-25334|Martha/i },
          { 'mailOptions.subject': /20233385|INC-25334/i },
          { 'meta.numeroCaso': caso.nmroAjste },
          { 'meta.casoId': String(caso._id) },
        ],
      })
      .limit(10)
      .toArray();
    docs.forEach((d) => resultados.push({ coleccion: nombre, doc: d }));
  }
  return resultados;
}

async function buscarHistorialFormularios(db, caso) {
  const colecciones = (await db.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => /historial/i.test(n));

  const resultados = [];
  for (const nombre of colecciones) {
    const col = db.collection(nombre);
    const docs = await col
      .find({
        $or: [
          { numeroCaso: caso.nmroAjste },
          { numeroCaso: caso.nmroSinstro },
          { casoId: String(caso._id) },
          { numeroCaso: /20233385|INC-25334/i },
        ],
      })
      .limit(10)
      .toArray();
    docs.forEach((d) => {
      const ch = d.datos?.control_horas || d.control_horas;
      if (controlHorasTieneDatos(ch)) {
        resultados.push({ coleccion: nombre, id: d._id, filas: ch.filas.length });
      }
    });
  }
  return resultados;
}

async function buscarS3(caso) {
  try {
    const { isS3StorageEnabled, storageConfig } = await import('../config/storage.js');
    if (!isS3StorageEnabled()) {
      return { habilitado: false, archivos: [] };
    }
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const bucket = storageConfig.bucket() || process.env.AWS_S3_BUCKET;
    const region = storageConfig.region() || process.env.AWS_REGION;
    const client = new S3Client({ region });
    const terminos = ['control', 'hora', '25334', '20233385', 'martha'];
    const prefijos = ['2026/2/06/17/', '2026/2/06/'];
    const archivos = [];

    for (const prefix of prefijos) {
      let token;
      do {
        const resp = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: token,
            MaxKeys: 500,
          })
        );
        for (const obj of resp.Contents || []) {
          const key = obj.Key || '';
          const low = key.toLowerCase();
          if (terminos.some((t) => low.includes(t)) || /control.*hora/i.test(low)) {
            archivos.push(key);
          }
        }
        token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
      } while (token && archivos.length < 50);
    }

    return { habilitado: true, archivos: archivos.slice(0, 30) };
  } catch (err) {
    return { habilitado: true, error: err.message, archivos: [] };
  }
}

async function main() {
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI no definido');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  const db = mongoose.connection.db;
  const col = db.collection('gsk3cAppsiniestro');

  const caso = await buscarCaso(col);
  if (!caso) {
    console.error('❌ Caso no encontrado:', arg);
    process.exit(1);
  }

  console.log('=== CASO ===');
  console.log('_id:', caso._id);
  console.log('nmroAjste:', caso.nmroAjste, '| siniestro:', caso.nmroSinstro);
  console.log('control_horas filas actuales:', caso.control_horas?.filas?.length ?? 0);

  console.log('\n=== ENVIOS FACTURACION (control_horas) ===');
  const envios = (caso.envios_facturacion || []).filter((e) => e?.tipo === 'control_horas');
  if (!envios.length) console.log('(ninguno)');
  envios.forEach((e) => {
    console.log('- fecha:', e.fecha, '| gerente:', e.gerente);
    console.log('  snapshot controlHoras filas:', e.controlHoras?.filas?.length ?? 0);
    console.log('  resumen:', e.resumenControlHoras || '(no guardado)');
  });

  console.log('\n=== HISTORIAL DOCS (controlHoras) ===');
  const docs = (caso.historialDocs || []).filter(
    (d) => d.tipo === 'controlHoras' || d.categoria === 'controlHoras'
  );
  if (!docs.length) console.log('(ninguno)');
  docs.forEach((d) => console.log('-', d.nombre, d.ruta || d.url || ''));

  console.log('\n=== EMAIL OUTBOX ===');
  const correos = await buscarEmailOutbox(db, caso);
  if (!correos.length) {
    console.log('(no hay correos de control_horas con referencia a este caso)');
  } else {
    correos.forEach(({ coleccion, doc: c }) => {
      console.log('- coleccion:', coleccion, '| _id:', c._id, '| status:', c.status, '| sentAt:', c.sentAt);
      const html = c.mailOptions?.html || '';
      const matchTotal = html.match(/Total horas:<\/td><td[^>]*>([^<]+)/i);
      const matchHonor = html.match(/Honorarios:<\/td><td[^>]*>([^<]+)/i);
      if (matchTotal) console.log('  total horas en correo:', matchTotal[1]);
      if (matchHonor) console.log('  honorarios en correo:', matchHonor[1]);
    });
  }

  console.log('\n=== HISTORIAL FORMULARIOS ===');
  const historial = await buscarHistorialFormularios(db, caso);
  if (!historial.length) console.log('(sin control_horas en historial)');
  historial.forEach((h) => console.log('-', h.coleccion, h.id, 'filas:', h.filas));

  console.log('\n=== OTRAS COLECCIONES CON control_horas ===');
  const otros = await buscarEnColecciones(db, caso);
  if (!otros.length) console.log('(ninguna coincidencia)');
  otros.forEach((o) => console.log('-', o.coleccion, 'docs:', o.count, o.ids));

  console.log('\n=== UPLOADS LOCALES (nombre relacionado) ===');
  const terminos = [caso.nmroAjste, caso.nmroSinstro, '25334', 'martha', 'control'];
  const archivos = recorrerUploads(UPLOADS, terminos).slice(0, 30);
  if (!archivos.length) console.log('(ninguno en uploads local)');
  archivos.forEach((a) => console.log('-', a));

  console.log('\n=== S3 (día del envío 17/06/2026) ===');
  const s3 = await buscarS3(caso);
  if (!s3.habilitado) console.log('(S3 no habilitado en este entorno)');
  else if (s3.error) console.log('Error S3:', s3.error);
  else if (!s3.archivos.length) console.log('(ningún archivo relacionado en S3 ese día)');
  else s3.archivos.forEach((k) => console.log('-', k));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
