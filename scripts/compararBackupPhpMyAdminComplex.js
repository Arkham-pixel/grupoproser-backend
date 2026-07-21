/**
 * Compara backups PHPMyAdmin (JSON) de gsk3c_appsiniestro vs MongoDB gsk3cAppsiniestro.
 *
 *   node scripts/compararBackupPhpMyAdminComplex.js
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

/** Mapa snake_case (MySQL legacy) -> camelCase (Mongo) */
const MAPA_CAMPOS = {
  nmro_ajste: 'nmroAjste',
  nmro_sinstro: 'nmroSinstro',
  codi_respnsble: 'codiRespnsble',
  codi_asgrdra: 'codiAsgrdra',
  asgr_benfcro: 'asgrBenfcro',
  ciudad_siniestro: 'ciudadSiniestro',
  codi_estdo: 'codiEstdo',
  fcha_asgncion: 'fchaAsgncion',
  fcha_sinstro: 'fchaSinstro',
  fcha_cont_ini: 'fchaContIni',
  fcha_inspccion: 'fchaInspccion',
  fcha_soli_docu: 'fchaSoliDocu',
  fcha_info_prelm: 'fchaInfoPrelm',
  fcha_info_fnal: 'fchaInfoFnal',
  fcha_repo_acti: 'fchaRepoActi',
};

const CAMPOS_CMP = Object.keys(MAPA_CAMPOS);

function dia(v) {
  if (v == null || v === '' || v === '0000-00-00' || v === '0000-00-00 00:00:00') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadPhpMyAdminTable(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  // El export es un array JSON con header/database/table; la tabla trae .data
  // a veces inválido si el archivo es enorme / cortado — intentar parse normal primero
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Intentar extraer el bloque data manualmente
    const idx = raw.indexOf('"data":');
    if (idx < 0) throw new Error('No se pudo parsear ni encontrar data');
    // buscar array después de data
    const start = raw.indexOf('[', idx);
    // el cierre suele ser ]}] al final
    let end = raw.lastIndexOf(']');
    // retroceder hasta el cierre del array data (antes del cierre table)
    // estructura: ... data: [ {...}, ... ] } ]
    const slice = raw.slice(start, end + 1);
    parsed = [{ type: 'table', data: JSON.parse(slice) }];
  }
  const table = (Array.isArray(parsed) ? parsed : []).find(
    (x) => x && x.type === 'table' && Array.isArray(x.data)
  );
  if (!table) throw new Error(`Sin tabla data en ${filePath}`);
  return {
    database: table.database || '',
    table: table.name || '',
    rows: table.data,
  };
}

function loadCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sep = text.includes(';') && text.indexOf(';') < text.indexOf(',') ? ';' : ',';
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (ch === sep && !inQ) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]).map((h) => h.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (cols.length === 1 && !cols[0]) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] ?? '').replace(/^"|"$/g, '');
    });
    rows.push(obj);
  }
  return rows;
}

async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });

  const live = await Complex.find({})
    .select(Object.values(MAPA_CAMPOS).join(' ') + ' updatedAt createdAt')
    .lean();
  const liveBy = new Map();
  for (const d of live) {
    const k = String(d.nmroAjste || '').trim();
    if (k) liveBy.set(k, d);
  }

  const backups = [
    path.join(process.env.USERPROFILE || '', 'Downloads', 'gsk3c_appsiniestro.json'),
    path.join(process.env.USERPROFILE || '', 'Downloads', 'gsk3c_appsiniestro (1).json'),
    path.join(process.env.USERPROFILE || '', 'Downloads', 'gsk3c_appsiniestro.csv'),
    path.join(process.env.USERPROFILE || '', 'Downloads', 'gsk3c_appsiniestro (1).csv'),
  ];

  const resultados = [];

  for (const bp of backups) {
    if (!fs.existsSync(bp)) {
      resultados.push({ backup: bp, ok: false, error: 'NO_EXISTE' });
      continue;
    }
    const st = fs.statSync(bp);
    let rows;
    let meta = {};
    try {
      if (bp.endsWith('.json')) {
        const loaded = loadPhpMyAdminTable(bp);
        rows = loaded.rows;
        meta = { database: loaded.database, table: loaded.table };
      } else {
        rows = loadCsv(bp);
        meta = { format: 'csv' };
      }
    } catch (e) {
      resultados.push({ backup: bp, ok: false, error: e.message, mtime: st.mtime, size: st.size });
      continue;
    }

    const by = new Map();
    let sinNmro = 0;
    for (const r of rows) {
      const k = String(r.nmro_ajste || r.nmroAjste || '').trim();
      if (!k) {
        sinNmro += 1;
        continue;
      }
      if (!by.has(k)) by.set(k, r);
    }

    let nSoloBackup = 0;
    let nSoloLive = 0;
    let nFechasPerdidas = 0;
    let nFechasDiff = 0;
    let nIdentPerdidos = 0;
    const sampleSoloBackup = [];
    const sampleSoloLive = [];
    const samplePerdidas = [];
    const sampleDiff = [];

    for (const [k, b] of by) {
      const l = liveBy.get(k);
      if (!l) {
        nSoloBackup += 1;
        if (sampleSoloBackup.length < 30) sampleSoloBackup.push(k);
        continue;
      }
      for (const snake of CAMPOS_CMP) {
        const camel = MAPA_CAMPOS[snake];
        const isFecha = snake.startsWith('fcha_');
        const bv = isFecha ? dia(b[snake]) : String(b[snake] ?? '').trim();
        const lv = isFecha ? dia(l[camel]) : String(l[camel] ?? '').trim();
        if (!bv) continue;
        if (!lv) {
          if (isFecha) {
            nFechasPerdidas += 1;
            if (samplePerdidas.length < 40)
              samplePerdidas.push({ nmroAjste: k, campo: camel, backup: bv });
          } else {
            nIdentPerdidos += 1;
          }
        } else if (isFecha && bv !== lv) {
          nFechasDiff += 1;
          if (sampleDiff.length < 30)
            sampleDiff.push({ nmroAjste: k, campo: camel, backup: bv, live: lv });
        }
      }
    }
    for (const k of liveBy.keys()) {
      if (!by.has(k)) {
        nSoloLive += 1;
        if (sampleSoloLive.length < 30) sampleSoloLive.push(k);
      }
    }

    resultados.push({
      backup: bp,
      ok: true,
      mtime: st.mtime,
      size: st.size,
      ...meta,
      backupRows: rows.length,
      backupUnicos: by.size,
      sinNmro,
      liveUnicos: liveBy.size,
      nSoloEnBackup_faltanEnMongo: nSoloBackup,
      nSoloEnMongo_noEstabanEnBackup: nSoloLive,
      nFechasPerdidasEnMongo: nFechasPerdidas,
      nFechasDiferentes: nFechasDiff,
      nIdentidadPerdida: nIdentPerdidos,
      sampleSoloBackup,
      sampleSoloLive,
      samplePerdidas,
      sampleDiff,
    });
  }

  // Conteo subtareas
  let subtareas = null;
  try {
    const cols = await mongoose.connection.db.listCollections({ name: 'gsk3cAppsubtareaComplex' }).toArray();
    if (cols.length) {
      const c = mongoose.connection.db.collection('gsk3cAppsubtareaComplex');
      subtareas = {
        total: await c.countDocuments(),
        porEstado: await c
          .aggregate([{ $group: { _id: '$estado', n: { $sum: 1 } } }])
          .toArray(),
      };
    }
  } catch (e) {
    subtareas = { error: e.message };
  }

  const out = {
    generadoEn: new Date().toISOString(),
    liveTotal: live.length,
    liveUnicos: liveBy.size,
    subtareas,
    resultados,
  };

  const outDir = path.join(process.cwd(), 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(
    outDir,
    `comparacion-backup-complex-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ ...out, reporteGuardadoEn: outFile }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
