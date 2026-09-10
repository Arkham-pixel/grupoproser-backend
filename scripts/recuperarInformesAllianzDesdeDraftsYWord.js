/**
 * Recupera informes Allianz listado vaciados por el autoguardado.
 *
 * Fuentes (en orden):
 *  1) Borrador Arnald más rico (cualquier usuario)
 *  2) Word del archivero (textos de secciones)
 *
 * Siempre respalda informeUnico + liquidador en
 *   gsk3cAppallianzListado_backupInforme_20260910
 *
 * Uso:
 *   node scripts/recuperarInformesAllianzDesdeDraftsYWord.js
 *   APPLY=1 node scripts/recuperarInformesAllianzDesdeDraftsYWord.js
 */
import { createRequire } from 'module';
import mongoose from 'mongoose';
import { resolveFileForRead, getDownloadUrl } from '../services/fileStorageService.js';
import { conectarMongoRobusto } from './_conectarMongoRobusto.js';

const APPLY = process.env.APPLY === '1';
const SOLO = String(process.env.SOLO || '').replace(/\D/g, '');
const BACKUP_COL = 'gsk3cAppallianzListado_backupInforme_20260910';
const require = createRequire(import.meta.url);
let JSZip = null;
try {
  JSZip = require('../../grupoproser-frontend/node_modules/jszip');
} catch {
  JSZip = null;
}

function t(v) {
  return String(v || '').trim();
}

function scoreInforme(inf) {
  if (!inf || typeof inf !== 'object') return 0;
  const textos = [
    inf.descripcionDanios,
    inf.conclusiones,
    inf.recomendacion,
    inf.analisisCobertura,
    inf.analisisNexoCausal,
  ]
    .map((s) => t(s))
    .filter((s) => s.length > 40);
  const filasD = (Array.isArray(inf.filasDanios) ? inf.filasDanios : []).filter(
    (f) => t(f?.condicion || f?.observacion || f?.descripcion).length > 15
  ).length;
  const filasP = (Array.isArray(inf.filasPolizaCobertura) ? inf.filasPolizaCobertura : []).filter(
    (f) => t(f?.analisis || f?.conclusion).length > 15
  ).length;
  const filasPpto = (Array.isArray(inf.filasPresupuestoPreliminar)
    ? inf.filasPresupuestoPreliminar
    : []
  ).filter(
    (f) => t(f?.descripcion).length > 15 || String(f?.valor || '').replace(/[^\d]/g, '').length > 3
  ).length;
  return textos.reduce((n, s) => n + s.length, 0) + filasD * 40 + filasP * 40 + filasPpto * 20;
}

function scoreLiq(liq) {
  if (!liq || typeof liq !== 'object') return 0;
  const items = liq?.evaluacionSismicaNSR10?.presupuesto?.items;
  const nItems = (Array.isArray(items) ? items : []).filter((it) =>
    t(it?.actividad || it?.componente || it?.capitulo || it?.descripcion)
  ).length;
  return nItems * 30 + t(liq.observaciones).length;
}

function textoMasRico(actual, candidato) {
  const a = t(actual);
  const b = t(candidato);
  if (!b) return actual ?? '';
  if (!a) return candidato;
  if (b.length > a.length + 30) return candidato;
  return actual;
}

function filasMasRicas(actual, candidato, hayDato) {
  const a = Array.isArray(actual) ? actual : [];
  const b = Array.isArray(candidato) ? candidato : [];
  const na = a.filter(hayDato).length;
  const nb = b.filter(hayDato).length;
  if (nb > na) return b;
  return a;
}

function extraerTextosXml(xml) {
  const partes = [];
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml))) {
    partes.push(
      String(m[1] || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
    );
  }
  return partes.join('').replace(/\s+/g, ' ').trim();
}

function parrafosWord(xml) {
  const bloques = [];
  const reP = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = reP.exec(xml))) {
    const txt = extraerTextosXml(m[1]);
    if (txt) bloques.push(txt);
  }
  return bloques;
}

function seccionEntre(parrafos, inicioRe, finRes) {
  const idx = parrafos.findIndex((p) => inicioRe.test(p));
  if (idx < 0) return '';
  const out = [];
  for (let i = idx + 1; i < parrafos.length; i += 1) {
    const p = parrafos[i];
    if (finRes.some((re) => re.test(p))) break;
    if (/^FIRMAS$/i.test(p)) break;
    out.push(p);
  }
  return out.join('\n\n').trim();
}

function tipoDesdeNombreWord(nombre) {
  const n = String(nombre || '').toLowerCase();
  if (n.includes('preliminar')) return 'preliminar';
  if (n.includes('final')) return 'final';
  if (n.includes('unico') || n.includes('único')) return 'unico';
  return '';
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

async function parsearInformeDesdeDocx(ruta, nombreOriginal) {
  if (!JSZip || !ruta) return null;
  try {
    let buf = null;
    try {
      const url = await Promise.race([
        getDownloadUrl(ruta),
        new Promise((_, reject) => setTimeout(() => reject(new Error('url timeout')), 8000)),
      ]);
      if (url) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 20000);
        const res = await fetch(url, { signal: ac.signal });
        clearTimeout(timer);
        if (res.ok) buf = Buffer.from(await res.arrayBuffer());
      }
    } catch (err) {
      console.warn(`  signed-url ${nombreOriginal}: ${err.message}`);
    }
    if (!buf?.length) {
      const file = await resolveFileForRead(ruta);
      if (file?.stream) buf = await streamToBuffer(file.stream);
      if (!buf && file?.localPath) {
        const fs = await import('fs/promises');
        buf = await fs.readFile(file.localPath);
      }
    }
    if (!buf?.length) return null;
    const zip = await JSZip.loadAsync(buf);
    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) return null;
    const xml = await xmlFile.async('string');
    const ps = parrafosWord(xml);
    const finComun = [
      /^\d+\.\s/,
      /^Análisis de nexo causal/i,
      /^Análisis de la cobertura/i,
      /^Análisis de póliza/i,
      /^Conclusiones/i,
      /^Recomendaci/i,
      /^Inspección fotográfica/i,
      /^Liquidación de pérdidas/i,
      /^Cotización vs presupuesto/i,
      /^FIRMAS$/i,
    ];
    const infoEvento = seccionEntre(ps, /Información general del evento/i, finComun);
    const descripcionDanios = seccionEntre(
      ps,
      /Descripción de los daños/i,
      finComun
    );
    const analisisNexoCausal = seccionEntre(ps, /^Análisis de nexo causal/i, finComun);
    const analisisCobertura = seccionEntre(
      ps,
      /^Análisis de (la )?cobertura|^Análisis de póliza/i,
      finComun
    );
    const conclusiones = seccionEntre(ps, /^Conclusiones/i, finComun);
    const recomendacion = seccionEntre(ps, /^Recomendaci/i, finComun);
    const parsed = {
      tipoInforme: tipoDesdeNombreWord(nombreOriginal),
      infoEvento,
      descripcionDanios: descripcionDanios.replace(/^ELEMENTO \/ ZONA.*/i, '').trim(),
      analisisNexoCausal,
      analisisCobertura,
      conclusiones,
      recomendacion,
    };
    const score = scoreInforme(parsed);
    return { parsed, score, nombreOriginal, chars: extraerTextosXml(xml).length };
  } catch (err) {
    return { error: err.message, nombreOriginal };
  }
}

function fusionarInforme(base, extra, origen) {
  if (!extra || typeof extra !== 'object') {
    return { out: base, cambios: [] };
  }
  const out = { ...(base && typeof base === 'object' ? base : {}) };
  const cambios = [];
  const campos = [
    'descripcionDanios',
    'conclusiones',
    'recomendacion',
    'analisisCobertura',
    'analisisNexoCausal',
    'infoEvento',
  ];
  for (const c of campos) {
    const next = textoMasRico(out[c], extra[c]);
    if (t(next) !== t(out[c])) {
      cambios.push(`${c}←${origen}(${t(extra[c]).length})`);
      out[c] = next;
    }
  }
  const danios = filasMasRicas(
    out.filasDanios,
    extra.filasDanios,
    (f) => t(f?.condicion || f?.observacion || f?.descripcion).length > 15
  );
  if (danios !== out.filasDanios) {
    cambios.push(`filasDanios←${origen}`);
    out.filasDanios = danios;
  }
  const poliza = filasMasRicas(
    out.filasPolizaCobertura,
    extra.filasPolizaCobertura,
    (f) => t(f?.analisis || f?.conclusion).length > 15
  );
  if (poliza !== out.filasPolizaCobertura) {
    cambios.push(`filasPoliza←${origen}`);
    out.filasPolizaCobertura = poliza;
  }
  const ppto = filasMasRicas(
    out.filasPresupuestoPreliminar,
    extra.filasPresupuestoPreliminar,
    (f) => t(f?.descripcion).length > 15 || String(f?.valor || '').replace(/[^\d]/g, '').length > 3
  );
  if (ppto !== out.filasPresupuestoPreliminar) {
    cambios.push(`filasPpto←${origen}`);
    out.filasPresupuestoPreliminar = ppto;
  }
  if (extra.tipoInforme && (!out.tipoInforme || out.tipoInforme === 'unico') && extra.tipoInforme !== 'unico') {
    cambios.push(`tipo←${origen}:${extra.tipoInforme}`);
    out.tipoInforme = extra.tipoInforme;
  } else if (extra.tipoInforme && !out.tipoInforme) {
    out.tipoInforme = extra.tipoInforme;
    cambios.push(`tipo←${origen}:${extra.tipoInforme}`);
  }
  const fotos = Array.isArray(extra.fotosInspeccion) ? extra.fotosInspeccion : [];
  const fotosActual = Array.isArray(out.fotosInspeccion) ? out.fotosInspeccion : [];
  if (fotos.length > fotosActual.length) {
    out.fotosInspeccion = fotos;
    cambios.push(`fotos←${origen}`);
  }
  return { out, cambios };
}

const db = await conectarMongoRobusto();
const col = db.collection('gsk3cAppallianzListadoCasos');
const draftsCol = db.collection('arnald_form_drafts');
const backupCol = db.collection(BACKUP_COL);

const filtroCasos = SOLO
  ? {
      $or: [
        { siniestro: new RegExp(SOLO) },
        { identificacion: new RegExp(SOLO) },
        { 'archivos.nombreOriginal': new RegExp(SOLO) },
      ],
    }
  : {
      $or: [{ informeUnico: { $type: 'object' } }, { liquidador: { $type: 'object' } }],
    };

const casos = await col
  .find(filtroCasos)
  .project({
    consecutivo: 1,
    siniestro: 1,
    identificacion: 1,
    asegurado: 1,
    informeUnico: 1,
    liquidador: 1,
    'archivos.nombreOriginal': 1,
    'archivos.nombreArchivo': 1,
    'archivos.ruta': 1,
  })
  .toArray();
console.log(`Casos leídos: ${casos.length}${SOLO ? ` (SOLO ${SOLO})` : ''}`);

const drafts = await draftsCol
  .find({ formKey: /allianz-listado-ws:/ })
  .toArray();

const draftsPorCaso = new Map();
for (const d of drafts) {
  const id = String(d.formKey || '').split(':').pop();
  if (!id) continue;
  const inf = d.payload?.informe || d.payload?.informeUnico || null;
  const liq = d.payload?.liquidador || null;
  const sInf = scoreInforme(inf);
  const sLiq = scoreLiq(liq);
  const prev = draftsPorCaso.get(id);
  if (!prev || sInf + sLiq > prev.sInf + prev.sLiq) {
    draftsPorCaso.set(id, {
      login: d.login,
      savedAt: d.savedAt,
      informe: inf,
      liquidador: liq,
      sInf,
      sLiq,
    });
  }
}

console.log(`Casos con informe/liq: ${casos.length}`);
console.log(`Borradores workspace: ${drafts.length} → ${draftsPorCaso.size} casos`);
console.log(`Modo: ${APPLY ? 'APPLY (escribe)' : 'DRY-RUN (solo muestra)'}`);
console.log(`JSZip: ${JSZip ? 'ok' : 'no disponible'}`);

const plan = [];
for (const caso of casos) {
  const id = String(caso._id);
  const actualInf = caso.informeUnico && typeof caso.informeUnico === 'object' ? caso.informeUnico : {};
  const actualLiq = caso.liquidador && typeof caso.liquidador === 'object' ? caso.liquidador : null;
  const sInf0 = scoreInforme(actualInf);
  const sLiq0 = scoreLiq(actualLiq);
  const draft = draftsPorCaso.get(id);

  let nextInf = actualInf;
  let nextLiq = actualLiq;
  const cambios = [];

  if (draft && (draft.sInf > sInf0 || (draft.sInf > 0 && sInf0 === 0))) {
    const fus = fusionarInforme(nextInf, draft.informe, `draft:${draft.login}`);
    nextInf = fus.out;
    cambios.push(...fus.cambios);
  }
  if (draft && draft.sLiq > sLiq0) {
    nextLiq = draft.liquidador;
    cambios.push(`liquidador←draft:${draft.login}(${draft.sLiq}>${sLiq0})`);
  }

  const words = (Array.isArray(caso.archivos) ? caso.archivos : []).filter((a) =>
    /\.docx$/i.test(a?.nombreOriginal || a?.nombreArchivo || '')
  );
  const sInfTrasDraft = scoreInforme(nextInf);
  const narrativaVacia =
    t(nextInf.descripcionDanios).length < 40 &&
    t(nextInf.conclusiones).length < 40 &&
    t(nextInf.analisisCobertura).length < 40 &&
    t(nextInf.analisisNexoCausal).length < 40;
  if (narrativaVacia && words.length && JSZip) {
    let best = null;
    for (const w of words) {
      const nombreW = w.nombreOriginal || w.nombreArchivo;
      console.log(`  Word ${caso.consecutivo} ${nombreW}`);
      let parsed = null;
      try {
        parsed = await Promise.race([
          parsearInformeDesdeDocx(w.ruta, nombreW),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout 45s leyendo Word')), 45000)
          ),
        ]);
      } catch (err) {
        console.warn(`  Word falló ${nombreW}: ${err.message}`);
        continue;
      }
      if (parsed?.error) console.warn(`  Word error ${nombreW}: ${parsed.error}`);
      if (!parsed?.parsed) continue;
      if (!best || parsed.score > best.score) best = parsed;
    }
    if (best?.parsed) {
      const fus = fusionarInforme(nextInf, best.parsed, `word:${best.nombreOriginal}`);
      nextInf = fus.out;
      cambios.push(...fus.cambios);
    }
  }

  const sInf1 = scoreInforme(nextInf);
  const sLiq1 = scoreLiq(nextLiq);
  if (!cambios.length && sInf1 <= sInf0 && sLiq1 <= sLiq0) continue;
  if (sInf1 === sInf0 && sLiq1 === sLiq0 && !cambios.length) continue;

  plan.push({
    id,
    consecutivo: caso.consecutivo,
    asegurado: caso.asegurado,
    sInf0,
    sInf1,
    sLiq0,
    sLiq1,
    cambios,
    nextInf,
    nextLiq,
    tipo: nextInf?.tipoInforme,
  });
}

console.log(`\nA restaurar: ${plan.length} casos\n`);
for (const p of plan) {
  console.log(
    `${p.consecutivo} | ${p.asegurado || '—'} | inf ${p.sInf0}→${p.sInf1} | liq ${p.sLiq0}→${p.sLiq1} | tipo=${p.tipo || ''} | ${p.cambios.join(', ')}`
  );
}

if (!APPLY) {
  console.log('\nNada escrito. Relanza con APPLY=1 para restaurar.');
  await mongoose.disconnect();
  process.exit(0);
}

let restored = 0;
for (const p of plan) {
  const caso = casos.find((c) => String(c._id) === p.id);
  await backupCol.updateOne(
    { casoId: caso._id },
    {
      $set: {
        casoId: caso._id,
        consecutivo: caso.consecutivo,
        backedUpAt: new Date(),
        informeUnico: caso.informeUnico ?? null,
        liquidador: caso.liquidador ?? null,
      },
    },
    { upsert: true }
  );
  const $set = { informeUnico: p.nextInf, updatedAt: new Date() };
  if (p.nextLiq && scoreLiq(p.nextLiq) > scoreLiq(caso.liquidador)) {
    $set.liquidador = p.nextLiq;
  }
  await col.updateOne({ _id: caso._id }, { $set });
  restored += 1;
}

console.log(`\nRestaurados: ${restored}. Backup en ${BACKUP_COL}`);
await mongoose.disconnect();
