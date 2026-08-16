/**
 * Prueba exacta: correo y celular se persisten al crear y al actualizar.
 * Módulos: Alfa, Sura, Zurich, Equidad FDM.
 *
 * Uso: node scripts/testContactoCatastroficoPersist.js
 * Los documentos de prueba se borran al terminar (también si falla).
 */

import '../config/loadEnv.js';
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import SegurosSuraCaso from '../models/SegurosSuraCaso.js';
import ZurichCaso from '../models/ZurichCaso.js';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import {
  FORM_VACIO_ALFA,
  construirFormDesdeCasoAlfa,
} from '../../grupoproser-frontend/src/components/SubcomponenteSegurosAlfa/segurosAlfaHelpers.js';
import {
  FORM_VACIO_SURA,
  construirFormDesdeCasoSura,
} from '../../grupoproser-frontend/src/components/SubcomponenteSura/segurosSuraHelpers.js';
import {
  FORM_VACIO_ZURICH,
  construirFormDesdecasoZurich,
} from '../../grupoproser-frontend/src/components/SubcomponenteZurich/zurichHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FRONT = path.join(ROOT, '..', 'grupoproser-frontend');
const TAG = `TEST-CONTACTO-${Date.now()}`;
const created = [];
let failed = 0;
let passed = 0;

function line(m) {
  console.log(m);
}

function pass(nombre) {
  passed += 1;
  line(`  PASS  ${nombre}`);
}

function fail(nombre, detalle) {
  failed += 1;
  line(`  FAIL  ${nombre}`);
  line(`        ${detalle}`);
}

function expectEqual(nombre, actual, expected) {
  try {
    assert.equal(actual, expected);
    pass(`${nombre}  [${JSON.stringify(actual)}]`);
  } catch {
    fail(
      nombre,
      `esperado=${JSON.stringify(expected)}  obtenido=${JSON.stringify(actual)}`
    );
  }
}

function expectTruthy(nombre, valor) {
  if (valor) pass(nombre);
  else fail(nombre, `valor vacío/falsy: ${JSON.stringify(valor)}`);
}

function readUtf8(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function readFront(rel) {
  return fs.readFileSync(path.join(FRONT, rel), 'utf8');
}

/** Misma regla que Alfa/Sura/Zurich/FDM al armar el payload. */
function toStringOrNull(value, fallback = null) {
  if (value === undefined) return fallback ?? null;
  if (value === null || value === '' || value === 'null' || value === 'undefined') {
    return null;
  }
  return String(value).trim();
}

async function persistirModulo({
  nombre,
  Model,
  crearDoc,
  correoCrear,
  celularCrear,
  correoUpdate,
  celularUpdate,
  lookup,
}) {
  line(`\n--- ${nombre}: crear → leer → actualizar → leer ---`);

  const payloadCrear = {
    ...crearDoc,
    correo: toStringOrNull(correoCrear),
    celular: toStringOrNull(celularCrear),
  };

  const creado = await Model.create(payloadCrear);
  created.push({ Model, id: creado._id });

  const leido1 = await Model.findById(creado._id).lean();
  expectTruthy(`${nombre} documento existe tras create`, leido1);
  expectEqual(`${nombre} create correo`, leido1?.correo, correoCrear.trim());
  expectEqual(`${nombre} create celular`, leido1?.celular, celularCrear.trim());

  const actualizado = await Model.findByIdAndUpdate(
    creado._id,
    {
      $set: {
        correo: toStringOrNull(correoUpdate),
        celular: toStringOrNull(celularUpdate),
      },
    },
    { new: true }
  ).lean();

  expectEqual(`${nombre} update correo`, actualizado?.correo, correoUpdate.trim());
  expectEqual(`${nombre} update celular`, actualizado?.celular, celularUpdate.trim());

  const leido2 = await Model.findById(creado._id).select('correo celular').lean();
  expectEqual(`${nombre} re-read correo`, leido2?.correo, correoUpdate.trim());
  expectEqual(`${nombre} re-read celular`, leido2?.celular, celularUpdate.trim());

  if (lookup) {
    const porLookup = await lookup(Model, crearDoc);
    expectEqual(`${nombre} lookup correo`, porLookup?.correo, correoUpdate.trim());
    expectEqual(`${nombre} lookup celular`, porLookup?.celular, celularUpdate.trim());
  }
}

async function cleanup() {
  line('\n--- Limpieza de casos de prueba ---');
  for (const item of created) {
    await item.Model.deleteOne({ _id: item.id });
  }
  const extra = await Promise.all([
    SegurosAlfaCaso.deleteMany({ identificacion: TAG }),
    SegurosSuraCaso.deleteMany({ identificacion: TAG }),
    ZurichCaso.deleteMany({ identificacion: TAG }),
    EquidadFdmCaso.deleteMany({ nombre: TAG }),
  ]);
  const borrados =
    created.length + extra.reduce((acc, r) => acc + (r.deletedCount || 0), 0);
  line(`  Borrados (ids + marker): ${created.length} ids rastreados, extra=${extra.map((r) => r.deletedCount).join('/')}`);
  return borrados;
}

async function main() {
  line('=== Persistencia correo + celular (catastróficos) ===');
  line(`TAG: ${TAG}`);

  line('\n--- Esquema Mongo: los campos existen ---');
  expectTruthy('Alfa schema.correo', SegurosAlfaCaso.schema.path('correo'));
  expectTruthy('Alfa schema.celular', SegurosAlfaCaso.schema.path('celular'));
  expectTruthy('Sura schema.correo', SegurosSuraCaso.schema.path('correo'));
  expectTruthy('Sura schema.celular', SegurosSuraCaso.schema.path('celular'));
  expectTruthy('Zurich schema.correo', ZurichCaso.schema.path('correo'));
  expectTruthy('Zurich schema.celular', ZurichCaso.schema.path('celular'));
  expectTruthy('FDM schema.celular', EquidadFdmCaso.schema.path('celular'));
  expectTruthy('FDM schema.correo', EquidadFdmCaso.schema.path('correo'));

  line('\n--- Código: payload y formularios incluyen los campos ---');
  const checks = [
    ['controllers/segurosAlfa.controller.js', "celular: toStringOrNull(data.celular"],
    ['controllers/segurosSura.controller.js', "celular: toStringOrNull(data.celular"],
    ['controllers/zurich.controller.js', "celular: toStringOrNull(data.celular"],
    ['controllers/equidadFdm.controller.js', "correo: toStringOrNull(data.correo"],
    ['services/alfaCasoService.js', "celular: toStringOrNull(data.celular"],
  ];
  for (const [file, needle] of checks) {
    const src = readUtf8(file);
    expectTruthy(`${file} mapea el campo`, src.includes(needle));
  }

  const formChecks = [
    ['src/components/SubcomponenteSegurosAlfa/FormularioSegurosAlfa.jsx', "setCampo('celular')"],
    ['src/components/SubcomponenteSura/FormularioSegurosSura.jsx', "setCampo('celular')"],
    ['src/components/SubcomponenteZurich/FormularioZurich.jsx', "setCampo('celular')"],
    ['src/components/SubcomponenteEquidadFdm/FormularioEquidadFdm.jsx', "setCampo('correo')"],
  ];
  for (const [file, needle] of formChecks) {
    const src = readFront(file);
    expectTruthy(`${path.basename(file)} casilla`, src.includes(needle));
  }

  line('\n--- Formulario: round-trip exacto (helpers) ---');
  expectEqual('FORM_VACIO_ALFA.celular', FORM_VACIO_ALFA.celular, '');
  expectEqual('FORM_VACIO_SURA.celular', FORM_VACIO_SURA.celular, '');
  expectEqual('FORM_VACIO_ZURICH.celular', FORM_VACIO_ZURICH.celular, '');

  const correoForm = 'juan.perez+terremoto@proserpuertos.com.co';
  const celularForm = '3000123456';
  const formAlfa = construirFormDesdeCasoAlfa({ correo: correoForm, celular: celularForm });
  expectEqual('Alfa form.correo', formAlfa.correo, correoForm);
  expectEqual('Alfa form.celular', formAlfa.celular, celularForm);
  const formSura = construirFormDesdeCasoSura({ correo: correoForm, celular: celularForm });
  expectEqual('Sura form.correo', formSura.correo, correoForm);
  expectEqual('Sura form.celular', formSura.celular, celularForm);
  const formZurich = construirFormDesdecasoZurich({ correo: correoForm, celular: celularForm });
  expectEqual('Zurich form.correo', formZurich.correo, correoForm);
  expectEqual('Zurich form.celular', formZurich.celular, celularForm);

  line('\n--- toStringOrNull: recorta espacios, no altera el valor ---');
  expectEqual(
    'trim correo',
    toStringOrNull('  oscar@grupoproser.com  '),
    'oscar@grupoproser.com'
  );
  expectEqual('trim celular', toStringOrNull('  3183514150  '), '3183514150');
  expectEqual('plus en correo', toStringOrNull('a+b@x.com'), 'a+b@x.com');
  expectEqual('celular sigue string', typeof toStringOrNull('3000123456'), 'string');

  if (!process.env.MONGO_URI) {
    fail('Mongo', 'MONGO_URI no está definida');
    line(`\nResumen: ${passed} PASS / ${failed} FAIL`);
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const correoCrear = `elkin.tapia+${TAG}@proserpuertos.com.co`;
    const celularCrear = '3183514150';
    const correoUpdate = `oscar.persist+${TAG}@grupoproser.com`;
    const celularUpdate = '3000123456';

    await persistirModulo({
      nombre: 'Alfa',
      Model: SegurosAlfaCaso,
      crearDoc: {
        consecutivo: `${TAG}-ALFA`,
        identificacion: TAG,
        asegurado: 'PRUEBA CONTACTO ALFA',
        estado: 'PENDIENTE',
      },
      correoCrear,
      celularCrear,
      correoUpdate,
      celularUpdate,
      lookup: (Model) => Model.findOne({ identificacion: TAG, consecutivo: `${TAG}-ALFA` }).lean(),
    });

    await persistirModulo({
      nombre: 'Sura',
      Model: SegurosSuraCaso,
      crearDoc: {
        consecutivo: `${TAG}-SURA`,
        identificacion: TAG,
        asegurado: 'PRUEBA CONTACTO SURA',
        estado: 'PENDIENTE',
      },
      correoCrear,
      celularCrear,
      correoUpdate,
      celularUpdate,
      lookup: (Model) => Model.findOne({ identificacion: TAG, consecutivo: `${TAG}-SURA` }).lean(),
    });

    await persistirModulo({
      nombre: 'Zurich',
      Model: ZurichCaso,
      crearDoc: {
        consecutivo: `${TAG}-ZURICH`,
        identificacion: TAG,
        asegurado: 'PRUEBA CONTACTO ZURICH',
        estado: 'PENDIENTE',
      },
      correoCrear,
      celularCrear,
      correoUpdate,
      celularUpdate,
      lookup: (Model) => Model.findOne({ identificacion: TAG, consecutivo: `${TAG}-ZURICH` }).lean(),
    });

    await persistirModulo({
      nombre: 'FDM',
      Model: EquidadFdmCaso,
      crearDoc: {
        consecutivo: `${TAG}-FDM`,
        nombre: TAG,
        evento: 'TERREMOTO 10 AGOSTO 2026',
        estado: 'PENDIENTE',
      },
      correoCrear,
      celularCrear,
      correoUpdate,
      celularUpdate,
      lookup: (Model) => Model.findOne({ nombre: TAG, consecutivo: `${TAG}-FDM` }).lean(),
    });
  } finally {
    await cleanup();
    const leftover = await Promise.all([
      SegurosAlfaCaso.countDocuments({ identificacion: TAG }),
      SegurosSuraCaso.countDocuments({ identificacion: TAG }),
      ZurichCaso.countDocuments({ identificacion: TAG }),
      EquidadFdmCaso.countDocuments({ nombre: TAG }),
    ]);
    expectEqual('sin residuos Alfa', leftover[0], 0);
    expectEqual('sin residuos Sura', leftover[1], 0);
    expectEqual('sin residuos Zurich', leftover[2], 0);
    expectEqual('sin residuos FDM', leftover[3], 0);
    await mongoose.disconnect();
  }

  line('');
  line(`Resumen: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error('FAIL no controlado', error);
  try {
    await cleanup();
  } catch {
    /* ignore */
  }
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
