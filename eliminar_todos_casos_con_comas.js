import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from './models/Complex.js';

/**
 * Script para eliminar TODOS los casos que tienen comas en nmroAjste
 * Estos casos son duplicados con formato incorrecto
 */

async function eliminarCasosConComas() {
  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Conectado a MongoDB\n');

    // Buscar TODOS los casos con comas en nmroAjste
    console.log('🔍 Buscando casos con comas en nmroAjste...');
    const casosConComas = await Complex.find({
      nmroAjste: { $regex: /,/ }
    }).lean();
    
    console.log(`📊 Casos con comas encontrados: ${casosConComas.length}\n`);

    if (casosConComas.length === 0) {
      console.log('✅ No hay casos con comas para eliminar');
      await mongoose.disconnect();
      return;
    }

    // Mostrar algunos ejemplos
    console.log('📋 Ejemplos de casos a eliminar (primeros 10):');
    casosConComas.slice(0, 10).forEach((caso, idx) => {
      console.log(`   ${idx + 1}. ${caso.nmroAjste} | Ciudad: ${caso.ciudadSiniestro || 'SIN CIUDAD'} | Asegurado: ${caso.asgrBenfcro || 'N/A'}`);
    });
    if (casosConComas.length > 10) {
      console.log(`   ... y ${casosConComas.length - 10} más\n`);
    }

    // Obtener los IDs para eliminar
    const idsAEliminar = casosConComas.map(c => c._id);

    // Confirmar eliminación
    console.log(`\n⚠️  Se eliminarán ${casosConComas.length} casos con comas en nmroAjste`);
    console.log('🗑️  Eliminando casos...\n');

    // Eliminar todos los casos con comas
    const resultado = await Complex.deleteMany({
      _id: { $in: idsAEliminar }
    });

    console.log('='.repeat(60));
    console.log('📊 RESUMEN DE ELIMINACIÓN');
    console.log('='.repeat(60));
    console.log(`✅ Casos eliminados: ${resultado.deletedCount}`);
    console.log('='.repeat(60));

    // Verificar que no queden casos con comas
    const casosRestantes = await Complex.countDocuments({
      nmroAjste: { $regex: /,/ }
    });

    if (casosRestantes > 0) {
      console.log(`\n⚠️  Aún quedan ${casosRestantes} casos con comas`);
    } else {
      console.log('\n✅ No quedan casos con comas en la base de datos');
    }

    await mongoose.disconnect();
    console.log('\n✅ Proceso completado');

  } catch (error) {
    console.error('\n❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

eliminarCasosConComas();


