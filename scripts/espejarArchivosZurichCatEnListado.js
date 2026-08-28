/**
 * Copia el archivero de inspección CAT Zurich al listado, solo para las
 * coincidencias del Excel (Z-CLAIMS + STRO + nombre/dirección).
 *
 * El CAT con fotos suele ser la ficha de inspección (sin ZC). El Excel enlaza
 * esa ficha con el caso de listado por asegurado y siniestro.
 *
 * Uso:
 *   node scripts/espejarArchivosZurichCatEnListado.js
 *   node scripts/espejarArchivosZurichCatEnListado.js --apply
 *   node scripts/espejarArchivosZurichCatEnListado.js "C:\\ruta\\Coincidencias_Asegurados.xlsx" --apply
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import ZurichCaso from '../models/ZurichCaso.js';
import ZurichListadoCaso from '../models/ZurichListadoCaso.js';
import {
  aplicarObservacionesYEstadoVerificadoZurich,
  espejarArchivosCasoZurichCatEnListado,
  textoObservacionesDesdeCatZurich,
} from '../utils/espejarArchivoZurichCatEnListado.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const APPLY = process.argv.includes('--apply');
const excelPath =
  args[0] || 'C:\\Users\\GP-TI\\Downloads\\Coincidencias_Asegurados.xlsx';

const stripAccents = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

const normClave = (valor) =>
  stripAccents(valor)
    .trim()
    .toUpperCase()
    .replace(/\.0$/, '')
    .replace(/\s+/g, '');

const normNombre = (valor) =>
  stripAccents(valor)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(
      /\b(PROPIEDAD HORIZONTAL|CONJUNTO RESIDENCIAL|CONJUNTO CERRADO|CONJUNTO|EDIFICIO|URBANIZACION|ETAPA|PH|P H|VIS|SAS|S A S|SA|S A|LTDA|COMPANIA)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

const tokensNombre = (valor) =>
  normNombre(valor)
    .split(' ')
    .filter((t) => t.length >= 3);

const levenshtein = (a, b) => {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j += 1) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i += 1) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[m];
};

const tokenEq = (a, b) => {
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen >= 6 && Math.abs(a.length - b.length) <= 2) {
    return levenshtein(a, b) <= 1;
  }
  return false;
};

const jaccardFuzzy = (a, b) => {
  if (!a.length || !b.length) return 0;
  const used = new Set();
  let inter = 0;
  for (const x of a) {
    const idx = b.findIndex((y, i) => !used.has(i) && tokenEq(x, y));
    if (idx >= 0) {
      used.add(idx);
      inter += 1;
    }
  }
  return inter / new Set([...a, ...b]).size;
};

const unicos = (arr) => {
  const m = new Map();
  for (const d of arr) m.set(String(d._id), d);
  return [...m.values()];
};

const findListado = (docs, zc, stro) =>
  unicos(
    docs.filter((d) => {
      const z = normClave(d.zc);
      const s = normClave(d.siniestro);
      return (zc && (z === zc || s === zc)) || (stro && (s === stro || z === stro));
    })
  );

const scoreCat = (row, cat) => {
  const nExcel = normNombre(row['Nombre Asegurado']);
  const nCat = normNombre(cat.asegurado);
  const tExcel = tokensNombre(row['Nombre Asegurado']);
  const tCat = tokensNombre(cat.asegurado);
  let score = 0;
  const via = [];
  if (nExcel && nCat && nExcel === nCat) {
    score += 80;
    via.push('nombre-exacto');
  } else {
    const j = jaccardFuzzy(tExcel, tCat);
    if (j >= 0.5) {
      score += Math.round(j * 70);
      via.push(`nombre-jaccard:${j.toFixed(2)}`);
    }
  }
  return { score, via };
};

const pickCat = (row, catDocs) => {
  const ranked = catDocs
    .map((cat) => ({ cat, ...scoreCat(row, cat) }))
    .filter((x) => x.score >= 50)
    .sort((a, b) => {
      const fa = (a.cat.archivos || []).length > 0 ? 1 : 0;
      const fb = (b.cat.archivos || []).length > 0 ? 1 : 0;
      if (fb !== fa) return fb - fa;
      if (b.score !== a.score) return b.score - a.score;
      const oa = String(a.cat.observacionesCat || a.cat.observaciones || '').trim() ? 1 : 0;
      const ob = String(b.cat.observacionesCat || b.cat.observaciones || '').trim() ? 1 : 0;
      return ob - oa;
    });
  const best = ranked[0] || null;
  const second = ranked[1] || null;
  if (!best) return { estado: 'sin-cat', best: null };
  if (second && best.score - second.score < 8 && second.score >= 50) {
    const bestFiles = (best.cat.archivos || []).length > 0;
    const secondFiles = (second.cat.archivos || []).length > 0;
    if (bestFiles && !secondFiles) return { estado: 'ok', best, second };
    if (bestFiles && secondFiles) return { estado: 'ambiguo', best, second };
  }
  return { estado: 'ok', best, second };
};

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 15000,
});

const wb = XLSX.readFile(excelPath);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
  defval: '',
  raw: false,
});

const [catDocs, lstDocs] = await Promise.all([
  ZurichCaso.find({}).select(
    'consecutivo zc siniestro asegurado direccionPredio ciudad archivos observaciones observacionesCat observacionReserva severidadCatNiveles evidenciaCat estado'
  ),
  ZurichListadoCaso.find({}).select(
    'consecutivo zc siniestro asegurado direccionPredio ciudad archivos observaciones observacionesCat estado fechaVerificado'
  ),
]);

const resumen = {
  dryRun: !APPLY,
  excel: rows.length,
  ok: 0,
  copiados: 0,
  duplicados: 0,
  observacionesCopiadas: 0,
  observacionesVacias: 0,
  estadosVerificado: 0,
  sinListado: 0,
  sinCat: 0,
  ambiguos: 0,
  errores: [],
  pares: [],
  omitidos: [],
};

for (const row of rows) {
  const zc = normClave(row['Z-CLAIMS'] ?? row['Z CLAIMS'] ?? row.ZC);
  const stro = normClave(row.STRO ?? row.SINIESTRO);
  const nombre = String(row['Nombre Asegurado'] || '').trim();
  const lstHits = findListado(lstDocs, zc, stro);
  const { estado, best, second } = pickCat(row, catDocs);

  const textoObs = best?.cat ? textoObservacionesDesdeCatZurich(best.cat) : '';
  const base = {
    nombre,
    zc,
    stro,
    listado: lstHits.map((d) => d.consecutivo),
    cat: best?.cat?.consecutivo || null,
    catAsegurado: best?.cat?.asegurado || null,
    score: best?.score || 0,
    via: best?.via || [],
    archivosCat: (best?.cat?.archivos || []).length,
    obsCatChars: textoObs.length,
  };

  if (!lstHits.length) {
    resumen.sinListado += 1;
    resumen.omitidos.push({ ...base, motivo: 'sin-listado' });
    continue;
  }
  if (lstHits.length > 1) {
    resumen.omitidos.push({ ...base, motivo: 'listado-ambiguo' });
    continue;
  }
  if (estado === 'ambiguo') {
    resumen.ambiguos += 1;
    resumen.omitidos.push({
      ...base,
      motivo: 'ambiguo',
      segundo: second?.cat?.consecutivo,
      segundoAsegurado: second?.cat?.asegurado,
    });
    continue;
  }
  if (estado === 'sin-cat') {
    resumen.sinCat += 1;
  }

  resumen.ok += 1;
  let copiados = 0;
  let duplicados = 0;
  let obs = { observacionesCopiadas: false, observacionesVacias: !textoObs, estadoCambiado: false };
  if (APPLY) {
    if (best?.cat) {
      const r = await espejarArchivosCasoZurichCatEnListado(best.cat, lstHits[0]);
      copiados = r.copiados;
      duplicados = r.duplicados;
      resumen.copiados += r.copiados;
      resumen.duplicados += r.duplicados;
      if (r.errores.length) resumen.errores.push(...r.errores.map((e) => ({ ...base, ...e })));
    }
    const datos = await aplicarObservacionesYEstadoVerificadoZurich(best?.cat || null, lstHits[0]);
    obs = datos;
    if (datos.observacionesCopiadas) resumen.observacionesCopiadas += 1;
    if (datos.observacionesVacias) resumen.observacionesVacias += 1;
    if (datos.estadoCambiado) resumen.estadosVerificado += 1;
    if (!datos.ok) resumen.errores.push({ ...base, ...datos });
  } else {
    const rutasLst = new Set(
      (lstHits[0].archivos || []).map((a) => String(a?.ruta || '')).filter(Boolean)
    );
    for (const a of best?.cat?.archivos || []) {
      const ruta = String(a?.ruta || '').trim();
      if (!ruta) continue;
      if (rutasLst.has(ruta)) duplicados += 1;
      else copiados += 1;
    }
    resumen.copiados += copiados;
    resumen.duplicados += duplicados;
    if (textoObs) resumen.observacionesCopiadas += 1;
    else resumen.observacionesVacias += 1;
    if (String(lstHits[0].estado || '') !== 'VERIFICADO') resumen.estadosVerificado += 1;
  }

  resumen.pares.push({
    ...base,
    listadoId: String(lstHits[0]._id),
    catId: best?.cat ? String(best.cat._id) : null,
    copiados,
    duplicados,
    observaciones: Boolean(textoObs),
    estadoActual: lstHits[0].estado || null,
  });
}

console.log(JSON.stringify(resumen, null, 2));
await mongoose.disconnect();
process.exit(resumen.errores.length ? 1 : 0);
