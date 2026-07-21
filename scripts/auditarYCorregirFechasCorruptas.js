/**
 * Auditoría y corrección de fechas corruptas en casos COMPLEX y Siniestros.
 *
 * Detecta en TODOS los campos de fecha (fcha* / fecha*):
 *  - Años imposibles (< 2015): típico error de serial Excel (1900-1902).
 *  - Fechas futuras imposibles (> hoy + 1 año).
 *
 * Estrategia de corrección (conservadora):
 *  1. Si el día/mes de la fecha corrupta coincide con otro hito válido del mismo
 *     caso → se repara usando el año de ese hito (corrupción típica de año).
 *  2. Si no hay coincidencia → se pone en null (mejor sin dato que dato falso).
 *
 * SIEMPRE guarda un respaldo JSON de los documentos afectados antes de escribir.
 *
 * Uso:
 *   node scripts/auditarYCorregirFechasCorruptas.js           → solo auditar (dry-run)
 *   node scripts/auditarYCorregirFechasCorruptas.js --apply   → corregir con respaldo
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Complex from '../models/Complex.js';
import Siniestro from '../models/CasoComplex.js';

const APPLY = process.argv.includes('--apply');

const ANIO_MINIMO_VALIDO = 2015;
const hoy = new Date();
const FECHA_MAXIMA_VALIDA = new Date(hoy.getFullYear() + 1, hoy.getMonth(), hoy.getDate());

const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI no definido');
  process.exit(1);
}
await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });

function esCampoFecha(clave) {
  const k = clave.toLowerCase();
  return k.startsWith('fcha') || k.startsWith('fecha');
}

function aFecha(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'string') {
    const s = valor.trim();
    if (!s) return null;
    const f = new Date(s);
    return Number.isNaN(f.getTime()) ? null : f;
  }
  return null;
}

function clasificar(fecha) {
  if (!fecha) return null;
  if (fecha.getFullYear() < ANIO_MINIMO_VALIDO) return 'ANIO_IMPOSIBLE';
  if (fecha > FECHA_MAXIMA_VALIDA) return 'FUTURO_IMPOSIBLE';
  return null;
}

/**
 * La corrupción observada conserva día y mes pero pierde el año (queda 1902).
 * Reparación:
 *  1. Otro hito válido del caso con el mismo día/mes → usar su año.
 *  2. Si no, usar el año de la fecha de asignación (o el siguiente, si el
 *     hito cae naturalmente después de fin de año) siempre que el resultado
 *     quede en una ventana plausible respecto a la asignación.
 */
function proponerReparacion(doc, campoCorrupto, fechaCorrupta) {
  const dia = fechaCorrupta.getDate();
  const mes = fechaCorrupta.getMonth();

  const candidatos = [];
  for (const [clave, valor] of Object.entries(doc)) {
    if (!esCampoFecha(clave) || clave === campoCorrupto) continue;
    const f = aFecha(valor);
    if (!f) continue;
    if (f.getFullYear() < ANIO_MINIMO_VALIDO || f > FECHA_MAXIMA_VALIDA) continue;
    if (f.getDate() === dia && f.getMonth() === mes) candidatos.push({ clave, anio: f.getFullYear() });
  }
  if (candidatos.length) {
    const anio = candidatos[0].anio;
    const reparada = new Date(fechaCorrupta.getTime());
    reparada.setFullYear(anio);
    if (reparada.getFullYear() >= ANIO_MINIMO_VALIDO && reparada <= FECHA_MAXIMA_VALIDA) {
      return { fecha: reparada, basadoEn: candidatos.map((c) => c.clave).join(', ') };
    }
  }

  const asignacion = aFecha(doc.fchaAsgncion) || aFecha(doc.fecha_asignacion) || aFecha(doc.createdAt);
  if (asignacion && asignacion.getFullYear() >= ANIO_MINIMO_VALIDO && asignacion <= FECHA_MAXIMA_VALIDA) {
    const margenAntes = 45 * 24 * 60 * 60 * 1000; // los hitos no ocurren mucho antes de la asignación
    for (const anio of [asignacion.getFullYear(), asignacion.getFullYear() + 1]) {
      const reparada = new Date(fechaCorrupta.getTime());
      reparada.setFullYear(anio);
      if (
        reparada.getTime() >= asignacion.getTime() - margenAntes &&
        reparada <= FECHA_MAXIMA_VALIDA
      ) {
        return { fecha: reparada, basadoEn: `año de fchaAsgncion (${asignacion.toISOString().slice(0, 10)})` };
      }
    }
  }

  return null;
}

async function auditarColeccion(Model, nombre) {
  const docs = await Model.find().lean();
  const hallazgos = [];

  docs.forEach((doc) => {
    for (const [clave, valor] of Object.entries(doc)) {
      if (!esCampoFecha(clave)) continue;
      const f = aFecha(valor);
      if (!f) continue;
      const tipo = clasificar(f);
      if (!tipo) continue;

      const reparacion = proponerReparacion(doc, clave, f);
      hallazgos.push({
        coleccion: nombre,
        _id: String(doc._id),
        ajuste: doc.nmroAjste || doc.numero_ajuste || '',
        campo: clave,
        valorActual: f.toISOString(),
        tipo,
        accion: reparacion ? 'REPARAR' : 'ANULAR',
        valorNuevo: reparacion ? reparacion.fecha.toISOString() : null,
        basadoEn: reparacion ? reparacion.basadoEn : '',
      });
    }
  });

  return { docs, hallazgos };
}

const [resComplex, resSiniestro] = await Promise.all([
  auditarColeccion(Complex, 'Complex'),
  auditarColeccion(Siniestro, 'CasoComplex(Siniestro)'),
]);

const hallazgos = [...resComplex.hallazgos, ...resSiniestro.hallazgos];

console.log('══════════════════════════════════════════════════════');
console.log(`AUDITORÍA DE FECHAS CORRUPTAS ${APPLY ? '(MODO CORRECCIÓN)' : '(SOLO LECTURA)'}`);
console.log('══════════════════════════════════════════════════════');
console.log(`Docs Complex revisados: ${resComplex.docs.length}`);
console.log(`Docs Siniestro revisados: ${resSiniestro.docs.length}`);
console.log(`Fechas corruptas encontradas: ${hallazgos.length}`);

const porTipo = {};
const porCampo = {};
hallazgos.forEach((h) => {
  porTipo[h.tipo] = (porTipo[h.tipo] || 0) + 1;
  porCampo[h.campo] = (porCampo[h.campo] || 0) + 1;
});
console.log('Por tipo:', porTipo);
console.log('Por campo:', porCampo);
console.log('');

hallazgos.forEach((h) => {
  console.log(
    `  [${h.coleccion}] ${h.ajuste || h._id} · ${h.campo} = ${h.valorActual.slice(0, 10)} (${h.tipo}) → ${h.accion}` +
      (h.valorNuevo ? ` ${h.valorNuevo.slice(0, 10)} (según ${h.basadoEn})` : ' (null)')
  );
});

if (!APPLY) {
  console.log('\nDry-run: no se modificó nada. Ejecute con --apply para corregir (con respaldo).');
  await mongoose.disconnect();
  process.exit(0);
}

if (!hallazgos.length) {
  console.log('\nNada que corregir.');
  await mongoose.disconnect();
  process.exit(0);
}

// ── Respaldo de documentos afectados ──
const idsAfectados = {
  Complex: new Set(hallazgos.filter((h) => h.coleccion === 'Complex').map((h) => h._id)),
  Siniestro: new Set(hallazgos.filter((h) => h.coleccion !== 'Complex').map((h) => h._id)),
};
const respaldo = {
  fecha: new Date().toISOString(),
  complex: resComplex.docs.filter((d) => idsAfectados.Complex.has(String(d._id))),
  siniestros: resSiniestro.docs.filter((d) => idsAfectados.Siniestro.has(String(d._id))),
  hallazgos,
};
const backupDir = path.resolve('backups');
fs.mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(
  backupDir,
  `respaldo-fechas-corruptas-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);
fs.writeFileSync(backupFile, JSON.stringify(respaldo, null, 2));
console.log(`\nRespaldo guardado en: ${backupFile}`);

// ── Aplicar correcciones ──
let corregidas = 0;
for (const h of hallazgos) {
  const Model = h.coleccion === 'Complex' ? Complex : Siniestro;
  const update = h.valorNuevo
    ? { $set: { [h.campo]: new Date(h.valorNuevo) } }
    : { $unset: { [h.campo]: '' } };
  const res = await Model.updateOne({ _id: h._id }, update);
  if (res.modifiedCount === 1) corregidas++;
}
console.log(`\nCorrecciones aplicadas: ${corregidas} de ${hallazgos.length}`);

await mongoose.disconnect();
