import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from './models/Complex.js';

/**
 * Script para actualizar los IDs de funcionarios en casos existentes
 * Convierte IDs antiguos a los nuevos según el mapeo
 */

// Mapeo de IDs de funcionarios: ID antiguo → ID nuevo
const MAPEO_IDS_FUNCIONARIOS = {
  '145': '137',
  '142': '131',
  '149': '138',
  '92': '130',
  '147': '134'
};

async function actualizarIdsFuncionarios() {
  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Conectado a MongoDB\n');

    console.log('📖 Buscando casos con IDs antiguos de funcionarios...\n');
    
    // Buscar casos que tengan IDs antiguos
    const casos = await Complex.find({
      funcAsgrdra: { $in: Object.keys(MAPEO_IDS_FUNCIONARIOS) }
    }).lean();
    
    console.log(`📊 Casos encontrados con IDs antiguos: ${casos.length}\n`);
    
    if (casos.length === 0) {
      console.log('✅ No hay casos que actualizar');
      await mongoose.disconnect();
      return;
    }
    
    let actualizados = 0;
    let errores = 0;
    
    for (const caso of casos) {
      try {
        const idAntiguo = String(caso.funcAsgrdra).trim();
        const idNuevo = MAPEO_IDS_FUNCIONARIOS[idAntiguo];
        
        if (idNuevo) {
          await Complex.updateOne(
            { _id: caso._id },
            { $set: { funcAsgrdra: idNuevo } }
          );
          
          console.log(`✅ Caso ${caso.nmroAjste}: ${idAntiguo} → ${idNuevo}`);
          actualizados++;
        }
      } catch (error) {
        console.error(`❌ Error actualizando caso ${caso.nmroAjste}:`, error.message);
        errores++;
      }
    }
    
    console.log('\n============================================================');
    console.log('📊 RESUMEN DEL PROCESO');
    console.log('============================================================');
    console.log(`📥 Total casos encontrados: ${casos.length}`);
    console.log(`✅ Casos actualizados: ${actualizados}`);
    console.log(`❌ Errores: ${errores}`);
    console.log('============================================================\n');
    
    await mongoose.disconnect();
    console.log('✅ Proceso completado exitosamente');
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

actualizarIdsFuncionarios();

