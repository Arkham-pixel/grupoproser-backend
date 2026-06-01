import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from './models/Complex.js';
import Ciudad from './models/Ciudad.js';

async function verificar() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado a MongoDB\n');

    // Códigos que aparecen en la imagen del usuario
    const codigosAVerificar = ['23807027', '13001000', '66045000', '08001001', '17873016', '05079001'];
    
    console.log('🔍 Verificando códigos específicos de la imagen:\n');
    
    for (const codigo of codigosAVerificar) {
      console.log(`\n📋 Código: ${codigo}`);
      
      // Buscar en la BD de ciudades
      const ciudad = await Ciudad.findOne({ 
        $or: [
          { codiCpoblado: codigo },
          { codiPoblado: codigo }
        ]
      }).lean();
      
      if (ciudad) {
        console.log(`   ✅ Encontrado en BD:`);
        console.log(`      - codiCpoblado: ${ciudad.codiCpoblado || 'N/A'}`);
        console.log(`      - descMunicipio: ${ciudad.descMunicipio || 'N/A'}`);
        console.log(`      - descCpoblado: ${ciudad.descCpoblado || 'N/A'}`);
        console.log(`      - descDepto: ${ciudad.descDepto || 'N/A'}`);
      } else {
        console.log(`   ❌ NO encontrado en BD`);
      }
      
      // Buscar casos con este código
      const casos = await Complex.find({ 
        ciudadSiniestro: codigo 
      })
        .select('nmroAjste ciudadSiniestro descripcionCiudad nombreCiudad')
        .limit(3)
        .lean();
      
      console.log(`   📊 Casos con este código: ${casos.length}`);
      casos.forEach((caso, idx) => {
        console.log(`      ${idx + 1}. Caso ${caso.nmroAjste}:`);
        console.log(`         descripcionCiudad: ${caso.descripcionCiudad || '❌ NO TIENE'}`);
        console.log(`         nombreCiudad: ${caso.nombreCiudad || '❌ NO TIENE'}`);
      });
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
  }
}

verificar();


