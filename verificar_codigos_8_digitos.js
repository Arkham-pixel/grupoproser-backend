import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from './models/Complex.js';
import Ciudad from './models/Ciudad.js';

async function verificar() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado a MongoDB\n');

    // Buscar casos con códigos de 8 dígitos
    const casosConCodigo8Digitos = await Complex.find({
      ciudadSiniestro: { $regex: /^\d{8}$/ }
    })
      .select('nmroAjste ciudadSiniestro descripcionCiudad nombreCiudad')
      .limit(10)
      .lean();
    
    console.log('📋 Casos con códigos de 8 dígitos (primeros 10):\n');
    
    for (const caso of casosConCodigo8Digitos) {
      console.log(`Caso: ${caso.nmroAjste}`);
      console.log(`  Código ciudad: ${caso.ciudadSiniestro}`);
      
      // Buscar en la BD de ciudades
      const ciudad = await Ciudad.findOne({ 
        $or: [
          { codiCpoblado: caso.ciudadSiniestro },
          { codiPoblado: caso.ciudadSiniestro }
        ]
      }).lean();
      
      if (ciudad) {
        console.log(`  ✅ Encontrado en BD:`);
        console.log(`     - codiCpoblado: ${ciudad.codiCpoblado || 'N/A'}`);
        console.log(`     - codiPoblado: ${ciudad.codiPoblado || 'N/A'}`);
        console.log(`     - descMunicipio: ${ciudad.descMunicipio || 'N/A'}`);
        console.log(`     - descCpoblado: ${ciudad.descCpoblado || 'N/A'}`);
        console.log(`     - descDepto: ${ciudad.descDepto || 'N/A'}`);
      } else {
        console.log(`  ❌ NO encontrado en BD`);
      }
      
      console.log(`  En caso Complex:`);
      console.log(`     - descripcionCiudad: ${caso.descripcionCiudad || '❌ SIN DESCRIPCIÓN'}`);
      console.log(`     - nombreCiudad: ${caso.nombreCiudad || '❌ SIN NOMBRE'}`);
      console.log('');
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
  }
}

verificar();


