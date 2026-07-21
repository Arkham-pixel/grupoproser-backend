/**
 * Auditoría de integridad COMPLEX vs backups locales (JSON/CSV exportados).
 * No imprime credenciales.
 *
 *   node scripts/auditarIntegridadComplex.js
 *   node scripts/auditarIntegridadComplex.js --backup "C:/Users/.../gsk3c_appsiniestro.json"
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Complex from '../models/Complex.js';

const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
if (!uri) {
  console.error('NO_MONGO_URI');
  process.exit(1);
}

function valorFlag(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return '';
  return String(process.argv[i + 1] || '').trim();
}

function vacio(v) {
  return v == null || v === '';
}

function keyCaso(doc) {
  const n = String(doc?.nmroAjste || doc?.NmroAjste || doc?.NMROAJSTE || '').trim();
  return n || String(doc?._id?.$oid || doc?._id || '').trim();
}

function pickFecha(doc, ...keys) {
  for (const k of keys) {
    if (!vacio(doc?.[k])) return String(doc[k]).slice(0, 10);
  }
  return '';
}

function loadBackupJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.casos)) return data.casos;
  if (Array.isArray(data?.documents)) return data.documents;
  // mongo export style: often array at root; if object with collection keys
  const firstArr = Object.values(data).find((v) => Array.isArray(v));
  if (firstArr) return firstArr;
  throw new Error(`Formato JSON no reconocido: ${filePath}`);
}

function summaryBackup(docs) {
  const byNmro = new Map();
  let sinNmro = 0;
  for (const d of docs) {
    const k = String(d?.nmroAjste || d?.NmroAjste || '').trim();
    if (!k) {
      sinNmro += 1;
      continue;
    }
    if (!byNmro.has(k)) byNmro.set(k, d);
  }
  return { total: docs.length, unicos: byNmro.size, sinNmro, byNmro };
}

const CAMPOS_FECHA = [
  'fchaAsgncion',
  'fchaSinstro',
  'fchaContIni',
  'fchaInspccion',
  'fchaSoliDocu',
  'fchaInfoPrelm',
  'fchaInfoFnal',
  'fchaRepoActi',
  'fchaPresentacionCifras',
  'fchaEnvioFiniquito',
  'fcha_control_horas',
];

const CAMPOS_ID = [
  'nmroAjste',
  'nmroSinstro',
  'codiRespnsble',
  'codiAsgrdra',
  'asgrBenfcro',
  'ciudadSiniestro',
  'codiEstdo',
];

async function main() {
  const hostSafe = uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@').replace(/\?.*/, '');
  console.log('Conectando a', hostSafe);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });

  const col = Complex.collection.name;
  const total = await Complex.countDocuments();
  const conNmro = await Complex.countDocuments({ nmroAjste: { $exists: true, $nin: [null, ''] } });
  const sinNmro = total - conNmro;

  const dupAgg = await Complex.aggregate([
    { $match: { nmroAjste: { $exists: true, $nin: [null, ''] } } },
    { $group: { _id: '$nmroAjste', c: { $sum: 1 } } },
    { $match: { c: { $gt: 1 } } },
    { $count: 'n' },
  ]);
  const duplicadosGrupos = dupAgg[0]?.n || 0;

  const cobertura = {};
  for (const c of [...CAMPOS_ID, ...CAMPOS_FECHA, 'historialDocs', 'control_horas']) {
    let filled;
    if (c === 'historialDocs') {
      filled = await Complex.countDocuments({
        historialDocs: { $exists: true, $type: 'array', $ne: [] },
      });
    } else if (c === 'control_horas') {
      filled = await Complex.countDocuments({
        $or: [
          { 'control_horas.filas.0': { $exists: true } },
          { 'control_horas.valor_hora': { $exists: true, $ne: null } },
        ],
      });
    } else {
      filled = await Complex.countDocuments({ [c]: { $exists: true, $nin: [null, ''] } });
    }
    cobertura[c] = {
      filled,
      empty: total - filled,
      pct: total ? Math.round((filled * 1000) / total) / 10 : 0,
    };
  }

  const creados7d = await Complex.countDocuments({
    createdAt: { $gte: new Date(Date.now() - 7 * 864e5) },
  });
  const upd7d = await Complex.countDocuments({
    updatedAt: { $gte: new Date(Date.now() - 7 * 864e5) },
  });

  const sospechososFechas = await Complex.countDocuments({
    historialDocs: { $exists: true, $type: 'array', $ne: [] },
    $or: [
      { fchaInspccion: { $in: [null, ''] } },
      { fchaInfoPrelm: { $in: [null, ''] } },
      { fchaContIni: { $in: [null, ''] } },
    ],
  });

  const controlHorasFechaSinFilas = await Complex.countDocuments({
    $and: [
      {
        $or: [
          { fcha_control_horas: { $nin: [null, ''] } },
          { fcha_envio_control_horas: { $nin: [null, ''] } },
        ],
      },
      {
        $or: [
          { control_horas: { $exists: false } },
          { 'control_horas.filas': { $size: 0 } },
          { 'control_horas.filas': { $exists: false } },
        ],
      },
    ],
  });

  const cols = await mongoose.connection.db.listCollections().toArray();
  const colNames = cols.map((c) => c.name).sort();
  const backupish = colNames.filter((n) =>
    /backup|bak|dump|copy|old|archive|complex|siniestro/i.test(n)
  );

  let stats = null;
  try {
    stats = await mongoose.connection.db.command({ collStats: col });
  } catch (e) {
    stats = { error: e.message };
  }

  // Load live map by nmroAjste
  const liveLean = await Complex.find({})
    .select(
      [
        'nmroAjste',
        'nmroSinstro',
        'codiRespnsble',
        'codiAsgrdra',
        'asgrBenfcro',
        'ciudadSiniestro',
        'codiEstdo',
        ...CAMPOS_FECHA,
        'historialDocs',
        'control_horas',
        'updatedAt',
        'createdAt',
      ].join(' ')
    )
    .lean();

  const liveByNmro = new Map();
  for (const d of liveLean) {
    const k = String(d.nmroAjste || '').trim();
    if (k) liveByNmro.set(k, d);
  }

  // Discover backups
  const defaultBackups = [
    path.join(process.env.USERPROFILE || '', 'Downloads', 'gsk3c_appsiniestro.json'),
    path.join(process.env.USERPROFILE || '', 'Downloads', 'gsk3c_appsiniestro (1).json'),
    valorFlag('--backup'),
  ].filter(Boolean);

  const comparaciones = [];
  for (const bp of defaultBackups) {
    if (!bp || !fs.existsSync(bp)) {
      if (bp) comparaciones.push({ backup: bp, ok: false, error: 'NO_EXISTE' });
      continue;
    }
    const st = fs.statSync(bp);
    let docs;
    try {
      docs = loadBackupJson(bp);
    } catch (e) {
      comparaciones.push({ backup: bp, ok: false, error: e.message, mtime: st.mtime });
      continue;
    }
    const sum = summaryBackup(docs);
    const soloEnBackup = [];
    const soloEnLive = [];
    const difFechas = [];
    const difIdentidad = [];

    for (const [k, b] of sum.byNmro) {
      const live = liveByNmro.get(k);
      if (!live) {
        if (soloEnBackup.length < 40) soloEnBackup.push(k);
        else if (soloEnBackup.length === 40) soloEnBackup.push('…');
        continue;
      }
      for (const campo of CAMPOS_FECHA) {
        const bv = pickFecha(b, campo);
        const lv = pickFecha(live, campo);
        // Solo marcar pérdida: backup tenía valor y live no, o live distinto
        if (bv && !lv) {
          if (difFechas.length < 80) {
            difFechas.push({ nmroAjste: k, campo, backup: bv, live: '', tipo: 'perdido_en_live' });
          }
        } else if (bv && lv && bv !== lv) {
          if (difFechas.length < 80) {
            difFechas.push({ nmroAjste: k, campo, backup: bv, live: lv, tipo: 'diferente' });
          }
        }
      }
      for (const campo of ['nmroSinstro', 'codiRespnsble', 'asgrBenfcro', 'codiEstdo']) {
        const bv = String(b[campo] ?? '').trim();
        const lv = String(live[campo] ?? '').trim();
        if (bv && !lv) {
          if (difIdentidad.length < 40) {
            difIdentidad.push({ nmroAjste: k, campo, backup: bv, live: '', tipo: 'perdido_en_live' });
          }
        }
      }
    }

    for (const k of liveByNmro.keys()) {
      if (!sum.byNmro.has(k)) {
        if (soloEnLive.length < 40) soloEnLive.push(k);
        else if (soloEnLive.length === 40) soloEnLive.push('…');
      }
    }

    // Exact counts for solo*
    let nSoloBackup = 0;
    let nSoloLive = 0;
    let nFechasPerdidas = 0;
    let nFechasDiff = 0;
    let nIdPerdidos = 0;
    for (const [k, b] of sum.byNmro) {
      const live = liveByNmro.get(k);
      if (!live) {
        nSoloBackup += 1;
        continue;
      }
      for (const campo of CAMPOS_FECHA) {
        const bv = pickFecha(b, campo);
        const lv = pickFecha(live, campo);
        if (bv && !lv) nFechasPerdidas += 1;
        else if (bv && lv && bv !== lv) nFechasDiff += 1;
      }
      for (const campo of ['nmroSinstro', 'codiRespnsble', 'asgrBenfcro', 'codiEstdo']) {
        const bv = String(b[campo] ?? '').trim();
        const lv = String(live[campo] ?? '').trim();
        if (bv && !lv) nIdPerdidos += 1;
      }
    }
    for (const k of liveByNmro.keys()) {
      if (!sum.byNmro.has(k)) nSoloLive += 1;
    }

    comparaciones.push({
      backup: bp,
      ok: true,
      mtime: st.mtime,
      sizeBytes: st.size,
      backupTotal: sum.total,
      backupUnicos: sum.unicos,
      backupSinNmro: sum.sinNmro,
      liveTotal: total,
      liveUnicos: liveByNmro.size,
      nSoloEnBackup_casosFaltanEnLive: nSoloBackup,
      nSoloEnLive_casosNuevosVsBackup: nSoloLive,
      nFechasPerdidasEnLive: nFechasPerdidas,
      nFechasDiferentes: nFechasDiff,
      nCamposIdentidadPerdidos: nIdPerdidos,
      sampleSoloBackup: soloEnBackup,
      sampleSoloLive: soloEnLive,
      sampleFechas: difFechas.slice(0, 25),
      sampleIdentidad: difIdentidad.slice(0, 15),
    });
  }

  const out = {
    generadoEn: new Date().toISOString(),
    collection: col,
    total,
    conNmro,
    sinNmro,
    duplicadosGrupos,
    actividad: { creados7d, upd7d },
    sospechososFechasConDocsSinHitosVacios: sospechososFechas,
    controlHorasFechaSinFilas,
    sizeBytes: stats?.size,
    storageSize: stats?.storageSize,
    backupishCollections: backupish,
    allCollectionsCount: colNames.length,
    cobertura,
    comparaciones,
  };

  const outDir = path.join(process.cwd(), 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(
    outDir,
    `auditoria-complex-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ ...out, reporteGuardadoEn: outFile }, null, 2));

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
