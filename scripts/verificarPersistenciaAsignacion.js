/**
 * Verificación de persistencia: catálogos catastróficos + campos asignación Alfa/Sura.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildAlfaCasoPayload } from '../services/alfaCasoService.js';
import { buildSuraPayload } from '../controllers/segurosSura.controller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const fail = (msg) => {
  console.error('FAIL:', msg);
  process.exitCode = 1;
};
const ok = (msg) => console.log('OK:', msg);

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // 1) Catálogo ajustadores
  const nAj = await db.collection('gsk3cAppajustadorcatastrofico').countDocuments();
  if (nAj < 1) fail(`ajustadores catastrofico vacíos (${nAj})`);
  else ok(`ajustadores catastrofico: ${nAj}`);

  // 2) CRUD inspector (insert → read → update → delete)
  const colIns = db.collection('gsk3cAppinspectorcatastrofico');
  const codigoTest = `TEST-INS-${Date.now()}`;
  const { insertedId } = await colIns.insertOne({
    codigo: codigoTest,
    nombre: 'Inspector Verificación',
    email: 'test@example.com',
    telefono: '3000000000',
    ciudad: 'Cali',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const leido = await colIns.findOne({ _id: insertedId });
  if (!leido || leido.ciudad !== 'Cali') fail('inspector no se guardó correctamente');
  else ok('inspector create+read');

  await colIns.updateOne({ _id: insertedId }, { $set: { ciudad: 'Pereira', updatedAt: new Date() } });
  const upd = await colIns.findOne({ _id: insertedId });
  if (upd?.ciudad !== 'Pereira') fail('inspector update falló');
  else ok('inspector update');

  await colIns.deleteOne({ _id: insertedId });
  const gone = await colIns.findOne({ _id: insertedId });
  if (gone) fail('inspector delete falló');
  else ok('inspector delete');

  // 3) Payload builders incluyen asignación
  const alfa = buildAlfaCasoPayload({
    identificacion: '123',
    estado: 'PENDIENTE',
    ajustadorLider: 'Silvia Juliana Rodríguez',
    ajustador: 'Alexander Escalante',
    inspector: 'Inspector Verificación',
  });
  if (
    alfa.ajustadorLider !== 'Silvia Juliana Rodríguez' ||
    alfa.ajustador !== 'Alexander Escalante' ||
    alfa.inspector !== 'Inspector Verificación'
  ) {
    fail(`buildAlfaCasoPayload perdió campos: ${JSON.stringify({
      ajustadorLider: alfa.ajustadorLider,
      ajustador: alfa.ajustador,
      inspector: alfa.inspector,
    })}`);
  } else ok('buildAlfaCasoPayload conserva asignación');

  const sura = buildSuraPayload({
    identificacion: '123',
    estado: 'PENDIENTE',
    ajustadorLider: 'Bernardo Sojo Guzmán',
    ajustador: 'Gabriel Moreno',
    inspector: 'Inspector X',
  });
  if (
    sura.ajustadorLider !== 'Bernardo Sojo Guzmán' ||
    sura.ajustador !== 'Gabriel Moreno' ||
    sura.inspector !== 'Inspector X'
  ) {
    fail(`buildSuraPayload perdió campos: ${JSON.stringify({
      ajustadorLider: sura.ajustadorLider,
      ajustador: sura.ajustador,
      inspector: sura.inspector,
    })}`);
  } else ok('buildSuraPayload conserva asignación');

  // 4) Round-trip real en un caso Alfa reciente (si existe)
  const casoAlfa = await db.collection('gsk3cAppsegurosAlfaCasos').findOne({}, { sort: { updatedAt: -1 } });
  if (casoAlfa?._id) {
    const marker = `VERIF-${Date.now()}`;
    const prev = {
      ajustadorLider: casoAlfa.ajustadorLider ?? null,
      ajustador: casoAlfa.ajustador ?? null,
      inspector: casoAlfa.inspector ?? null,
    };
    await db.collection('gsk3cAppsegurosAlfaCasos').updateOne(
      { _id: casoAlfa._id },
      {
        $set: {
          ajustadorLider: 'Silvia Juliana Rodríguez',
          ajustador: marker,
          inspector: 'Inspector Test',
        },
      }
    );
    const after = await db.collection('gsk3cAppsegurosAlfaCasos').findOne({ _id: casoAlfa._id });
    if (after.ajustador !== marker || after.ajustadorLider !== 'Silvia Juliana Rodríguez' || after.inspector !== 'Inspector Test') {
      fail('Alfa Mongo update no persistió asignación');
    } else ok(`Alfa Mongo round-trip ok (${casoAlfa.consecutivo || casoAlfa._id})`);
    // restaurar
    await db.collection('gsk3cAppsegurosAlfaCasos').updateOne({ _id: casoAlfa._id }, { $set: prev });
  } else {
    console.log('SKIP: no hay casos Alfa para round-trip');
  }

  const casoSura = await db.collection('gsk3cAppsegurosSuraCasos').findOne({}, { sort: { updatedAt: -1 } });
  if (casoSura?._id) {
    const marker = `VERIF-SURA-${Date.now()}`;
    const prev = {
      ajustadorLider: casoSura.ajustadorLider ?? null,
      ajustador: casoSura.ajustador ?? null,
      inspector: casoSura.inspector ?? null,
    };
    await db.collection('gsk3cAppsegurosSuraCasos').updateOne(
      { _id: casoSura._id },
      {
        $set: {
          ajustadorLider: 'Bernardo Sojo Guzmán',
          ajustador: marker,
          inspector: 'Inspector Test Sura',
        },
      }
    );
    const after = await db.collection('gsk3cAppsegurosSuraCasos').findOne({ _id: casoSura._id });
    if (
      after.ajustador !== marker ||
      after.ajustadorLider !== 'Bernardo Sojo Guzmán' ||
      after.inspector !== 'Inspector Test Sura'
    ) {
      fail('Sura Mongo update no persistió asignación');
    } else ok(`Sura Mongo round-trip ok (${casoSura.consecutivo || casoSura._id})`);
    await db.collection('gsk3cAppsegurosSuraCasos').updateOne({ _id: casoSura._id }, { $set: prev });
  } else {
    console.log('SKIP: no hay casos Sura para round-trip');
  }

  // 5) HTTP API catálogos
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
  try {
    const r = await fetch(`${base}/api/ajustadores-catastrofico`);
    const j = await r.json();
    const n = Array.isArray(j?.data) ? j.data.length : 0;
    if (!r.ok || n < 1) fail(`HTTP GET ajustadores: status=${r.status} n=${n}`);
    else ok(`HTTP GET ajustadores-catastrofico: ${n}`);

    const r2 = await fetch(`${base}/api/inspectores-catastrofico`);
    const j2 = await r2.json();
    if (!r2.ok) fail(`HTTP GET inspectores: status=${r2.status}`);
    else ok(`HTTP GET inspectores-catastrofico: ${Array.isArray(j2?.data) ? j2.data.length : 0}`);
  } catch (e) {
    fail(`HTTP API no respondió (${e.message}) — ¿backend arriba?`);
  }

  // 6) Schemas mongoose tienen los campos
  const Alfa = (await import('../models/SegurosAlfaCaso.js')).default;
  const Sura = (await import('../models/SegurosSuraCaso.js')).default;
  for (const campo of ['ajustadorLider', 'ajustador', 'inspector']) {
    if (!Alfa.schema.path(campo)) fail(`Alfa schema sin ${campo}`);
    if (!Sura.schema.path(campo)) fail(`Sura schema sin ${campo}`);
  }
  ok('schemas Alfa/Sura tienen ajustadorLider, ajustador, inspector');

  await mongoose.disconnect();
  if (!process.exitCode) console.log('\nRESULTADO: todo OK — los datos se guardan');
  else console.log('\nRESULTADO: hay fallos');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
