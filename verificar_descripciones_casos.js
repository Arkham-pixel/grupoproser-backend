import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from './models/Complex.js';

async function verificar() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado a MongoDB\n');

    // Buscar casos con códigos de ciudad pero sin descripción
    const casosConCodigoSinDescripcion = await Complex.find({
      ciudadSiniestro: { $exists: true, $ne: '' },
      $or: [
        { descripcionCiudad: { $exists: false } },
        { descripcionCiudad: '' },
        { descripcionCiudad: null }
      ]
    })
      .select('nmroAjste ciudadSiniestro descripcionCiudad nombreCiudad descripcionEstado codiEstdo')
      .limit(10)
      .lean();
    
    console.log(`📊 Casos con código de ciudad pero SIN descripción: ${casosConCodigoSinDescripcion.length}\n`);
    
    if (casosConCodigoSinDescripcion.length > 0) {
      console.log('📋 Primeros 10 casos sin descripción:\n');
      casosConCodigoSinDescripcion.forEach((caso, idx) => {
        console.log(`${idx + 1}. Caso: ${caso.nmroAjste}`);
        console.log(`   Código ciudad: ${caso.ciudadSiniestro}`);
        console.log(`   descripcionCiudad: ${caso.descripcionCiudad || '❌ NO TIENE'}`);
        console.log(`   nombreCiudad: ${caso.nombreCiudad || '❌ NO TIENE'}`);
        console.log(`   Estado código: ${caso.codiEstdo}`);
        console.log(`   descripcionEstado: ${caso.descripcionEstado || '❌ NO TIENE'}`);
        console.log('');
      });
    } else {
      console.log('✅ Todos los casos tienen descripciones o no tienen código de ciudad\n');
    }

    // Verificar casos con descripciones
    const casosConDescripcion = await Complex.find({
      descripcionCiudad: { $exists: true, $ne: '', $ne: null }
    })
      .select('nmroAjste ciudadSiniestro descripcionCiudad nombreCiudad')
      .limit(5)
      .lean();
    
    console.log(`\n📊 Casos CON descripción de ciudad: ${await Complex.countDocuments({ descripcionCiudad: { $exists: true, $ne: '', $ne: null } })}`);
    if (casosConDescripcion.length > 0) {
      console.log('\n📋 Primeros 5 casos CON descripción:\n');
      casosConDescripcion.forEach((caso, idx) => {
        console.log(`${idx + 1}. Caso: ${caso.nmroAjste}`);
        console.log(`   Código: ${caso.ciudadSiniestro}`);
        console.log(`   Descripción: ${caso.descripcionCiudad}`);
        console.log(`   Nombre: ${caso.nombreCiudad || 'N/A'}`);
        console.log('');
      });
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
  }
}

verificar();


