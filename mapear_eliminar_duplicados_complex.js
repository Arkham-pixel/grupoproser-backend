import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from './models/Complex.js';

/**
 * Script para mapear y eliminar casos duplicados en Complex
 * Identifica duplicados por nmroAjste y mantiene el más reciente
 */

async function mapearDuplicados() {
  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Conectado a MongoDB\n');

    console.log('🔍 Buscando casos duplicados por nmroAjste...\n');

    // Agregación para encontrar duplicados
    const duplicados = await Complex.aggregate([
      {
        $group: {
          _id: '$nmroAjste',
          count: { $sum: 1 },
          ids: { $push: '$_id' },
          casos: {
            $push: {
              id: '$_id',
              createdAt: '$createdAt',
              updatedAt: '$updatedAt',
              fchaAsgncion: '$fchaAsgncion',
              asgrBenfcro: '$asgrBenfcro',
              ciudadSiniestro: '$ciudadSiniestro',
              tieneCiudad: { $cond: [{ $and: [{ $ne: ['$ciudadSiniestro', null] }, { $ne: ['$ciudadSiniestro', ''] }] }, 1, 0] },
              camposCompletos: {
                $add: [
                  { $cond: [{ $ne: ['$ciudadSiniestro', null] }, 1, 0] },
                  { $cond: [{ $ne: ['$fchaAsgncion', null] }, 1, 0] },
                  { $cond: [{ $ne: ['$fchaSinstro', null] }, 1, 0] },
                  { $cond: [{ $ne: ['$asgrBenfcro', null] }, 1, 0] },
                  { $cond: [{ $ne: ['$codiRespnsble', null] }, 1, 0] },
                  { $cond: [{ $ne: ['$codiAsgrdra', null] }, 1, 0] }
                ]
              }
            }
          }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    if (duplicados.length === 0) {
      console.log('✅ No se encontraron casos duplicados');
      await mongoose.disconnect();
      return;
    }

    console.log(`⚠️ Se encontraron ${duplicados.length} casos con duplicados\n`);
    console.log('='.repeat(80));
    console.log('📊 MAPEO DE CASOS DUPLICADOS');
    console.log('='.repeat(80));

    let totalDuplicados = 0;
    let casosAEliminar = [];
    let casosAMantener = [];

    for (const dup of duplicados) {
      const nmroAjste = dup._id;
      const cantidad = dup.count;
      totalDuplicados += (cantidad - 1); // Restamos 1 porque uno se mantiene

      console.log(`\n📋 Número Ajuste: ${nmroAjste} (${cantidad} duplicados)`);
      console.log('-'.repeat(80));

      // Ordenar casos por: más reciente, más completo, con ciudad
      const casosOrdenados = dup.casos.sort((a, b) => {
        // Prioridad 1: Más reciente (updatedAt o createdAt)
        const fechaA = a.updatedAt || a.createdAt || new Date(0);
        const fechaB = b.updatedAt || b.createdAt || new Date(0);
        if (fechaB.getTime() !== fechaA.getTime()) {
          return fechaB.getTime() - fechaA.getTime();
        }
        // Prioridad 2: Más campos completos
        if (b.camposCompletos !== a.camposCompletos) {
          return b.camposCompletos - a.camposCompletos;
        }
        // Prioridad 3: Tiene ciudad
        if (b.tieneCiudad !== a.tieneCiudad) {
          return b.tieneCiudad - a.tieneCiudad;
        }
        return 0;
      });

      const casoAMantener = casosOrdenados[0];
      const casosDuplicados = casosOrdenados.slice(1);

      console.log(`✅ CASO A MANTENER (más reciente/completo):`);
      console.log(`   ID: ${casoAMantener.id}`);
      console.log(`   Creado: ${casoAMantener.createdAt || 'N/A'}`);
      console.log(`   Actualizado: ${casoAMantener.updatedAt || 'N/A'}`);
      console.log(`   Asegurado: ${casoAMantener.asgrBenfcro || 'N/A'}`);
      console.log(`   Ciudad: ${casoAMantener.ciudadSiniestro || 'NO TIENE'}`);
      console.log(`   Campos completos: ${casoAMantener.camposCompletos}/6`);

      console.log(`\n🗑️ CASOS DUPLICADOS A ELIMINAR (${casosDuplicados.length}):`);
      casosDuplicados.forEach((caso, idx) => {
        console.log(`   ${idx + 1}. ID: ${caso.id}`);
        console.log(`      Creado: ${caso.createdAt || 'N/A'}`);
        console.log(`      Actualizado: ${caso.updatedAt || 'N/A'}`);
        console.log(`      Asegurado: ${caso.asgrBenfcro || 'N/A'}`);
        console.log(`      Ciudad: ${caso.ciudadSiniestro || 'NO TIENE'}`);
        console.log(`      Campos completos: ${caso.camposCompletos}/6`);
        
        casosAEliminar.push(caso.id);
      });

      casosAMantener.push({
        nmroAjste,
        id: casoAMantener.id,
        cantidadDuplicados: casosDuplicados.length
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 RESUMEN');
    console.log('='.repeat(80));
    console.log(`Total casos con duplicados: ${duplicados.length}`);
    console.log(`Total duplicados a eliminar: ${totalDuplicados}`);
    console.log(`Total casos a mantener: ${casosAMantener.length}`);
    console.log(`IDs a eliminar: ${casosAEliminar.length}`);

    // Guardar mapeo en archivo
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    
    const mapeo = {
      fecha: new Date().toISOString(),
      resumen: {
        totalCasosConDuplicados: duplicados.length,
        totalDuplicadosAEliminar: totalDuplicados,
        totalCasosAMantener: casosAMantener.length
      },
      casosAMantener: casosAMantener,
      casosAEliminar: casosAEliminar.map(id => id.toString()),
      detalle: duplicados.map(dup => ({
        nmroAjste: dup._id,
        cantidad: dup.count,
        casos: dup.casos.map(c => ({
          id: c.id.toString(),
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          asgrBenfcro: c.asgrBenfcro,
          ciudadSiniestro: c.ciudadSiniestro,
          camposCompletos: c.camposCompletos
        }))
      }))
    };

    const archivoMapeo = path.join(__dirname, 'mapeo_duplicados_complex.json');
    fs.writeFileSync(archivoMapeo, JSON.stringify(mapeo, null, 2), 'utf8');
    console.log(`\n💾 Mapeo guardado en: ${archivoMapeo}`);

    // Preguntar si eliminar
    console.log('\n⚠️ ¿Deseas eliminar los duplicados?');
    console.log('   Para eliminar, ejecuta: node mapear_eliminar_duplicados_complex.js --eliminar');
    
    // Si se pasa --eliminar como argumento, eliminar duplicados
    if (process.argv.includes('--eliminar')) {
      console.log('\n🗑️ Eliminando duplicados...');
      
      if (casosAEliminar.length === 0) {
        console.log('✅ No hay casos a eliminar');
      } else {
        const resultado = await Complex.deleteMany({
          _id: { $in: casosAEliminar }
        });
        
        console.log(`✅ Se eliminaron ${resultado.deletedCount} casos duplicados`);
        console.log(`✅ Se mantuvieron ${casosAMantener.length} casos únicos`);
      }
    }

    await mongoose.disconnect();
    console.log('\n✅ Proceso completado');

  } catch (error) {
    console.error('\n❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Ejecutar
mapearDuplicados();

