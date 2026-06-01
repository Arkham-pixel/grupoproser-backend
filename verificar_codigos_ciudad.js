import 'dotenv/config';
import mongoose from 'mongoose';
import Ciudad from './models/Ciudad.js';
import Complex from './models/Complex.js';

async function verificar() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado a MongoDB\n');

    // Obtener algunos códigos de ciudad de casos Complex
    const casos = await Complex.find({ ciudadSiniestro: { $exists: true, $ne: null, $ne: '' } })
      .select('ciudadSiniestro')
      .limit(10)
      .lean();
    
    console.log('📋 Códigos de ciudad en casos Complex (primeros 10):');
    casos.forEach(c => {
      console.log(`   - "${c.ciudadSiniestro}" (tipo: ${typeof c.ciudadSiniestro}, longitud: ${String(c.ciudadSiniestro).length})`);
    });

    // Buscar en la tabla de ciudades
    console.log('\n🔍 Buscando en tabla de ciudades...\n');
    
    // Probar con un código específico
    const codigoPrueba = '08001001';
    console.log(`Buscando código: "${codigoPrueba}"`);
    
    const ciudadPorCodigo = await Ciudad.findOne({ codiMunicipio: codigoPrueba }).lean();
    console.log('Por codiMunicipio:', ciudadPorCodigo ? '✅ Encontrado' : '❌ No encontrado');
    if (ciudadPorCodigo) {
      console.log('   Datos:', ciudadPorCodigo);
    }
    
    // Buscar por codiPoblado también
    const ciudadPorPoblado = await Ciudad.findOne({ codiPoblado: codigoPrueba }).lean();
    console.log('Por codiPoblado:', ciudadPorPoblado ? '✅ Encontrado' : '❌ No encontrado');
    if (ciudadPorPoblado) {
      console.log('   Datos:', ciudadPorPoblado);
    }

    // Ver estructura de algunas ciudades
    console.log('\n📋 Ejemplos de ciudades en la BD (primeras 5):');
    const ciudadesEjemplo = await Ciudad.find({}).limit(5).lean();
    ciudadesEjemplo.forEach(c => {
      console.log(`   - codiMunicipio: "${c.codiMunicipio}", codiPoblado: "${c.codiPoblado}", descMunicipio: "${c.descMunicipio}"`);
    });

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
  }
}

verificar();


