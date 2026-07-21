/**
 * Análisis de la tabla "Cumplimiento de trazabilidad por responsable" del Dashboard COMPLEX.
 * Replica la lógica de DashboardComplex.jsx (calcularRetrasoEtapa + cumplimientoPorResponsable)
 * y lista, caso por caso, las etapas retrasadas de un responsable.
 *
 * Uso: node scripts/analizarRetrasosDashboardResponsable.js "Bernardo Sojo"
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from '../models/Complex.js';
import Siniestro from '../models/CasoComplex.js';
import Responsable from '../models/Responsable.js';
import { diasHabilesColombiaEntre } from '../utils/festivosColombia.js';

const filtroNombre = (process.argv[2] || 'Bernardo Sojo').toLowerCase();

const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI no definido');
  process.exit(1);
}
await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });

const [casosComplex, siniestros, responsables] = await Promise.all([
  Complex.find().lean(),
  Siniestro.find().lean(),
  Responsable.find().lean(),
]);

// Mapa código → nombre (igual que los endpoints /enriquecidos y /api/complex)
const mapaResponsables = {};
responsables.forEach((r) => {
  if (r.codiRespnsble) {
    const codigo = String(r.codiRespnsble).trim().toUpperCase();
    mapaResponsables[codigo] = r.nmbrRespnsble;
    mapaResponsables[codigo.replace(/\s+/g, '')] = r.nmbrRespnsble;
  }
});

function nombreResponsable(caso) {
  if (caso.nombreResponsable && String(caso.nombreResponsable).toLowerCase() !== 'sin asignar') {
    return caso.nombreResponsable;
  }
  if (caso.responsable_form && caso.responsable_form !== 'Sin asignar') return caso.responsable_form;
  const cod = caso.codiRespnsble || caso.codi_responble || caso.responsable;
  if (cod) {
    const c = String(cod).trim().toUpperCase();
    return mapaResponsables[c] || mapaResponsables[c.replace(/\s+/g, '')] || String(cod);
  }
  return 'Sin asignar';
}

// Unificación igual que el dashboard: dedupe por número de ajuste (complex primero)
const casosUnicos = new Map();
casosComplex.forEach((c) => {
  const n = c.nmroAjste || c.numero_ajuste;
  const clave = n ? String(n) : String(c._id);
  if (!casosUnicos.has(clave)) casosUnicos.set(clave, { ...c, origen: 'complex' });
});
siniestros.forEach((s) => {
  const n = s.nmroAjste || s.numero_ajuste;
  const clave = n ? String(n) : String(s._id);
  if (!casosUnicos.has(clave)) casosUnicos.set(clave, { ...s, origen: 'siniestro' });
});
const casos = Array.from(casosUnicos.values());

// ── Réplica exacta de calcularRetrasoEtapa del DashboardComplex ──
const tiemposLimite = {
  contactoInicial: 0.5,
  inspeccion: 1,
  solicitudDocs: 1,
  informePreliminar: 1,
  ultimoDocumento: 3,
  informeFinal: 3,
};
const etapasEnDiasHabiles = new Set(['informePreliminar', 'ultimoDocumento', 'informeFinal']);
const ETAPAS = ['contactoInicial', 'inspeccion', 'solicitudDocs', 'informePreliminar', 'informeFinal'];

function parsearFecha(v) {
  if (!v) return null;
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const s = String(v);
  if (s.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.split('T')[0].split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const f = new Date(s);
  return Number.isNaN(f.getTime()) ? null : new Date(f.getFullYear(), f.getMonth(), f.getDate());
}

function fechasEtapa(caso, tipo) {
  const ref =
    tipo === 'contactoInicial' ? parsearFecha(caso.fchaAsgncion)
    : tipo === 'inspeccion' ? (caso.fchaProgInspeccion ? parsearFecha(caso.fchaProgInspeccion) : parsearFecha(caso.fchaAsgncion))
    : tipo === 'solicitudDocs' || tipo === 'informePreliminar' ? parsearFecha(caso.fchaInspccion)
    : tipo === 'informeFinal' ? parsearFecha(caso.fchaRepoActi)
    : null;
  const fin =
    tipo === 'contactoInicial' ? parsearFecha(caso.fchaContIni)
    : tipo === 'inspeccion' ? parsearFecha(caso.fchaInspccion)
    : tipo === 'solicitudDocs' ? parsearFecha(caso.fchaSoliDocu)
    : tipo === 'informePreliminar' ? parsearFecha(caso.fchaInfoPrelm)
    : tipo === 'informeFinal' ? parsearFecha(caso.fchaInfoFnal)
    : null;
  return { ref, fin };
}

function retrasoEtapa(caso, tipo) {
  const { ref, fin } = fechasEtapa(caso, tipo);
  if (!ref || !fin) return null;
  const limite = tiemposLimite[tipo] || 1;

  const diasCalendario = (fin.getTime() - ref.getTime()) / (1000 * 3600 * 24);
  const retrasoViejo = diasCalendario > limite ? diasCalendario - limite : 0;

  const diasNuevo =
    etapasEnDiasHabiles.has(tipo) && diasCalendario >= 0
      ? diasHabilesColombiaEntre(ref, fin)
      : diasCalendario;
  const retrasoNuevo = diasNuevo > limite ? diasNuevo - limite : 0;

  return { ref, fin, diasCalendario, retrasoViejo, diasNuevo, retrasoNuevo };
}

// ── Agregación por responsable (misma semántica de la tabla) ──
function agregarPorResponsable(usarNuevo) {
  const mapa = {};
  casos.forEach((caso) => {
    const nombre = nombreResponsable(caso);
    if (!mapa[nombre]) {
      mapa[nombre] = { totalCasos: 0, casosCumplidos: 0, etapasRetrasadas: 0, totalDiasRetraso: 0 };
    }
    const r = mapa[nombre];
    r.totalCasos++;
    let evaluadas = 0;
    let todasCumplidas = true;
    ETAPAS.forEach((etapa) => {
      const res = retrasoEtapa(caso, etapa);
      if (!res) return;
      evaluadas++;
      const retraso = usarNuevo ? res.retrasoNuevo : res.retrasoViejo;
      if (retraso > 0) {
        todasCumplidas = false;
        r.etapasRetrasadas++;
        r.totalDiasRetraso += retraso;
      }
    });
    if (evaluadas > 0 && todasCumplidas) r.casosCumplidos++;
  });
  return mapa;
}

const viejo = agregarPorResponsable(false);
const nuevo = agregarPorResponsable(true);

const nombreObjetivo = Object.keys(viejo).find((n) => n.toLowerCase().includes(filtroNombre));
if (!nombreObjetivo) {
  console.log('No se encontró responsable que coincida con:', filtroNombre);
  console.log('Responsables disponibles:', Object.keys(viejo).slice(0, 30));
  process.exit(0);
}

const fmt = (d) => (d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '—');

console.log('══════════════════════════════════════════════════════════');
console.log('RESPONSABLE:', nombreObjetivo);
console.log('══════════════════════════════════════════════════════════');
const v = viejo[nombreObjetivo];
const n = nuevo[nombreObjetivo];
console.log('\n— Lógica ANTERIOR (días calendario, la de la captura):');
console.log(`  Total casos: ${v.totalCasos} | Cumplidos: ${v.casosCumplidos} | Etapas retrasadas: ${v.etapasRetrasadas}`);
console.log(`  Prom. días retraso: ${(v.totalDiasRetraso / (v.etapasRetrasadas || 1)).toFixed(1)}`);
console.log('\n— Lógica NUEVA (días hábiles Colombia en prelim/último doc/informe final):');
console.log(`  Total casos: ${n.totalCasos} | Cumplidos: ${n.casosCumplidos} | Etapas retrasadas: ${n.etapasRetrasadas}`);
console.log(`  Prom. días retraso: ${(n.totalDiasRetraso / (n.etapasRetrasadas || 1)).toFixed(1)}`);

// Detalle por caso
const detalle = [];
casos.forEach((caso) => {
  if (nombreResponsable(caso) !== nombreObjetivo) return;
  ETAPAS.forEach((etapa) => {
    const res = retrasoEtapa(caso, etapa);
    if (res && res.retrasoViejo > 0) {
      detalle.push({
        ajuste: caso.nmroAjste || caso.numero_ajuste || String(caso._id),
        origen: caso.origen,
        etapa,
        ref: fmt(res.ref),
        fin: fmt(res.fin),
        retrasoViejo: Math.round(res.retrasoViejo * 10) / 10,
        retrasoNuevo: Math.round(res.retrasoNuevo * 10) / 10,
      });
    }
  });
});

detalle.sort((a, b) => b.retrasoViejo - a.retrasoViejo);
console.log(`\nDETALLE: ${detalle.length} etapas retrasadas (lógica anterior) en los casos de ${nombreObjetivo}`);
console.log('Top 40 por días de retraso (viejo → nuevo):\n');
detalle.slice(0, 40).forEach((d) => {
  console.log(
    `  ${d.ajuste} [${d.origen}] ${d.etapa}: ref ${d.ref} → ${d.fin} | retraso viejo ${d.retrasoViejo} d | nuevo ${d.retrasoNuevo} d`
  );
});

// Cuántas etapas dejan de estar retrasadas con la lógica nueva
const corregidas = detalle.filter((d) => d.retrasoNuevo === 0).length;
console.log(`\nEtapas que DEJAN de contar como retrasadas con días hábiles: ${corregidas} de ${detalle.length}`);

// Distribución por etapa
const porEtapa = {};
detalle.forEach((d) => { porEtapa[d.etapa] = (porEtapa[d.etapa] || 0) + 1; });
console.log('Retrasos por etapa (lógica anterior):', porEtapa);

// Casos con retrasos absurdos (fechas corruptas: > 300 días)
const sospechosos = detalle.filter((d) => d.retrasoViejo > 300);
console.log(`\nEtapas con retraso > 300 días (posibles fechas corruptas): ${sospechosos.length}`);
sospechosos.slice(0, 15).forEach((d) => {
  console.log(`  ${d.ajuste} ${d.etapa}: ${d.ref} → ${d.fin} (${d.retrasoViejo} días)`);
});

await mongoose.disconnect();
