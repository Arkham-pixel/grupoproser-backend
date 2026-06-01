import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from './models/Complex.js';

async function verificar() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado a MongoDB\n');

    // Obtener algunos casos de ejemplo
    const casos = await Complex.find({})
      .select('nmroAjste codiEstdo descripcionEstado ciudadSiniestro descripcionCiudad nombreCiudad departamentoCiudad')
      .limit(10)
      .lean();
    
    console.log('📋 VERIFICACIÓN DE CONEXIÓN DE CÓDIGOS\n');
    console.log('='.repeat(80));
    
    casos.forEach((caso, idx) => {
      console.log(`\n${idx + 1}. Caso: ${caso.nmroAjste}`);
      console.log(`   Estado:`);
      console.log(`     - Código: ${caso.codiEstdo || 'N/A'}`);
      console.log(`     - Descripción: ${caso.descripcionEstado || '❌ SIN DESCRIPCIÓN'}`);
      console.log(`   Ciudad:`);
      console.log(`     - Código: ${caso.ciudadSiniestro || 'N/A'}`);
      console.log(`     - Nombre: ${caso.nombreCiudad || '❌ SIN NOMBRE'}`);
      console.log(`     - Departamento: ${caso.departamentoCiudad || '❌ SIN DEPARTAMENTO'}`);
      console.log(`     - Descripción completa: ${caso.descripcionCiudad || '❌ SIN DESCRIPCIÓN'}`);
    });

    // Estadísticas
    const total = await Complex.countDocuments({});
    const conEstado = await Complex.countDocuments({ descripcionEstado: { $exists: true, $ne: null, $ne: '' } });
    const conCiudad = await Complex.countDocuments({ descripcionCiudad: { $exists: true, $ne: null, $ne: '' } });
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 ESTADÍSTICAS');
    console.log('='.repeat(80));
    console.log(`Total casos: ${total}`);
    console.log(`Casos con descripción de estado: ${conEstado} (${((conEstado/total)*100).toFixed(1)}%)`);
    console.log(`Casos con descripción de ciudad: ${conCiudad} (${((conCiudad/total)*100).toFixed(1)}%)`);
    console.log('='.repeat(80));

    await mongoose.disconnect();
    console.log('\n✅ Verificación completada');
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
  }
}

verificar();


