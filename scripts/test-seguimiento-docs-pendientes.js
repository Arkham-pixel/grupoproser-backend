/**
 * Prueba de persistencia: seguimiento documentos pendientes + fchaUltSegui en MongoDB.
 * Uso: node scripts/test-seguimiento-docs-pendientes.js [--apply]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Complex from '../models/Complex.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const FECHA_SEG = '2026-07-01';
const RUTA_S3_PRUEBA = 's3:complex/test/evidencia-seguimiento-docs-prueba.pdf';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI no definida en .env');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log('✅ Conectado a MongoDB');

  const caso = await Complex.findOne({ historialDocs: { $exists: true } })
    .sort({ updatedAt: -1 })
    .lean();

  if (!caso) {
    console.error('❌ No hay casos en gsk3cAppsiniestro para probar');
    process.exit(1);
  }

  console.log(`📋 Caso de prueba: ${caso._id} (${caso.nmroAjste || 'sin ajuste'})`);
  const historialAntes = Array.isArray(caso.historialDocs) ? caso.historialDocs.length : 0;
  const segAntes = (caso.historialDocs || []).filter(
    (d) => d.tipo === 'seguimientoDocsPendientes' || d.categoria === 'seguimientoDocsPendientes'
  ).length;

  console.log(`   historialDocs: ${historialAntes} | seguimientoDocsPendientes: ${segAntes}`);
  console.log(`   fchaUltSegui actual: ${caso.fchaUltSegui || caso.fcha_ult_segui || '—'}`);

  const entradaPrueba = {
    tipo: 'seguimientoDocsPendientes',
    categoria: 'seguimientoDocsPendientes',
    fecha: FECHA_SEG,
    fechaSubida: new Date().toISOString().slice(0, 19),
    destinatario: 'intermediario',
    observacion: 'Prueba automatizada seguimiento docs pendientes',
    comentario: 'Prueba automatizada seguimiento docs pendientes',
    nombre: 'evidencia-seguimiento-docs-prueba.pdf',
    ruta: RUTA_S3_PRUEBA,
    url: RUTA_S3_PRUEBA,
    tamano: 1024,
    tipoMime: 'application/pdf',
    usuario: 'test-script',
  };

  if (!APPLY) {
    console.log('\n🔍 Modo dry-run (sin escribir). Ejecute con --apply para persistir.');
    console.log('   Se agregaría entrada:', entradaPrueba);
    console.log(`   fchaUltSegui → ${FECHA_SEG}`);
    await mongoose.disconnect();
    return;
  }

  const historialNuevo = [entradaPrueba, ...(caso.historialDocs || [])];
  const actualizado = await Complex.findByIdAndUpdate(
    caso._id,
    {
      $set: {
        historialDocs: historialNuevo,
        fchaUltSegui: new Date(`${FECHA_SEG}T12:00:00`),
      },
    },
    { new: true, runValidators: false }
  ).lean();

  const segDespues = (actualizado.historialDocs || []).filter(
    (d) => d.tipo === 'seguimientoDocsPendientes' || d.categoria === 'seguimientoDocsPendientes'
  );
  const ultimo = segDespues[0];

  const okHistorial = segDespues.length === segAntes + 1;
  const okFecha = (() => {
    if (!actualizado.fchaUltSegui) return false;
    const d = new Date(actualizado.fchaUltSegui);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}` === FECHA_SEG;
  })();
  const okRuta = ultimo?.ruta === RUTA_S3_PRUEBA;

  console.log('\n📊 Resultado:');
  console.log(`   historialDocs seguimiento: ${segAntes} → ${segDespues.length} ${okHistorial ? '✅' : '❌'}`);
  console.log(`   fchaUltSegui: ${actualizado.fchaUltSegui} ${okFecha ? '✅' : '❌'}`);
  console.log(`   ruta S3 en entrada: ${ultimo?.ruta} ${okRuta ? '✅' : '❌'}`);

  // Limpiar entrada de prueba
  await Complex.findByIdAndUpdate(caso._id, {
    $set: {
      historialDocs: caso.historialDocs || [],
      fchaUltSegui: caso.fchaUltSegui || caso.fcha_ult_segui || null,
    },
  });
  console.log('\n🧹 Entrada de prueba revertida en el caso.');

  await mongoose.disconnect();
  if (!okHistorial || !okFecha || !okRuta) process.exit(1);
  console.log('\n✅ Prueba de persistencia MongoDB OK');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
