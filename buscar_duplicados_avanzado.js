import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from './models/Complex.js';

/**
 * Script avanzado para buscar duplicados por diferentes criterios
 */

async function buscarDuplicados() {
  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Conectado a MongoDB\n');

    // 1. Buscar duplicados exactos por nmroAjste
    console.log('🔍 1. Buscando duplicados exactos por nmroAjste...');
    const duplicadosExactos = await Complex.aggregate([
      {
        $group: {
          _id: '$nmroAjste',
          count: { $sum: 1 },
          ids: { $push: '$_id' }
        }
      },
      {
        $match: {
          count: { $gt: 1 },
          _id: { $ne: null }
        }
      }
    ]);

    console.log(`   Encontrados: ${duplicadosExactos.length} casos con duplicados exactos\n`);

    // 2. Buscar duplicados normalizados (sin espacios, sin comas)
    console.log('🔍 2. Buscando duplicados normalizados (sin espacios/comas)...');
    
    const todosLosCasos = await Complex.find({}).lean();
    
    // Normalizar nmroAjste
    const casosNormalizados = todosLosCasos.map(caso => ({
      ...caso,
      nmroAjsteNormalizado: caso.nmroAjste 
        ? String(caso.nmroAjste).replace(/[\s,]/g, '').trim()
        : null
    }));

    // Agrupar por nmroAjste normalizado
    const grupos = {};
    casosNormalizados.forEach(caso => {
      const key = caso.nmroAjsteNormalizado;
      if (key) {
        if (!grupos[key]) {
          grupos[key] = [];
        }
        grupos[key].push(caso);
      }
    });

    // Encontrar duplicados normalizados
    const duplicadosNormalizados = Object.entries(grupos)
      .filter(([_, casos]) => casos.length > 1)
      .map(([normalizado, casos]) => ({
        normalizado,
        count: casos.length,
        casos: casos.map(c => ({
          id: c._id,
          nmroAjste: c.nmroAjste,
          asgrBenfcro: c.asgrBenfcro,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt
        }))
      }));

    console.log(`   Encontrados: ${duplicadosNormalizados.length} casos con duplicados normalizados\n`);

    // 3. Buscar por combinación de campos únicos
    console.log('🔍 3. Buscando duplicados por combinación (nmroAjste + nmroSinstro)...');
    const duplicadosCombinados = await Complex.aggregate([
      {
        $match: {
          nmroAjste: { $ne: null },
          nmroSinstro: { $ne: null }
        }
      },
      {
        $group: {
          _id: {
            nmroAjste: '$nmroAjste',
            nmroSinstro: '$nmroSinstro'
          },
          count: { $sum: 1 },
          ids: { $push: '$_id' }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);

    console.log(`   Encontrados: ${duplicadosCombinados.length} combinaciones duplicadas\n`);

    // Mostrar resultados
    console.log('='.repeat(80));
    console.log('📊 RESUMEN DE DUPLICADOS');
    console.log('='.repeat(80));
    console.log(`Duplicados exactos (nmroAjste): ${duplicadosExactos.length}`);
    console.log(`Duplicados normalizados: ${duplicadosNormalizados.length}`);
    console.log(`Duplicados por combinación: ${duplicadosCombinados.length}\n`);

    // Mostrar detalles de duplicados exactos
    if (duplicadosExactos.length > 0) {
      console.log('📋 DETALLE DE DUPLICADOS EXACTOS:');
      console.log('-'.repeat(80));
      for (const dup of duplicadosExactos.slice(0, 10)) {
        console.log(`\nNúmero Ajuste: "${dup._id}" (${dup.count} duplicados)`);
        console.log(`  IDs: ${dup.ids.slice(0, 3).map(id => id.toString()).join(', ')}${dup.ids.length > 3 ? '...' : ''}`);
      }
      if (duplicadosExactos.length > 10) {
        console.log(`\n... y ${duplicadosExactos.length - 10} más`);
      }
    }

    // Mostrar detalles de duplicados normalizados
    if (duplicadosNormalizados.length > 0) {
      console.log('\n\n📋 DETALLE DE DUPLICADOS NORMALIZADOS:');
      console.log('-'.repeat(80));
      for (const dup of duplicadosNormalizados.slice(0, 10)) {
        console.log(`\nNormalizado: "${dup.normalizado}" (${dup.count} variaciones)`);
        dup.casos.forEach((caso, idx) => {
          console.log(`  ${idx + 1}. ID: ${caso.id}`);
          console.log(`     Original: "${caso.nmroAjste}"`);
          console.log(`     Asegurado: ${caso.asgrBenfcro || 'N/A'}`);
        });
      }
      if (duplicadosNormalizados.length > 10) {
        console.log(`\n... y ${duplicadosNormalizados.length - 10} más`);
      }
    }

    // Guardar mapeo completo
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    
    const mapeo = {
      fecha: new Date().toISOString(),
      resumen: {
        duplicadosExactos: duplicadosExactos.length,
        duplicadosNormalizados: duplicadosNormalizados.length,
        duplicadosCombinados: duplicadosCombinados.length
      },
      duplicadosExactos: duplicadosExactos.map(dup => ({
        nmroAjste: dup._id,
        cantidad: dup.count,
        ids: dup.ids.map(id => id.toString())
      })),
      duplicadosNormalizados: duplicadosNormalizados.map(dup => ({
        normalizado: dup.normalizado,
        cantidad: dup.count,
        casos: dup.casos
      })),
      duplicadosCombinados: duplicadosCombinados.map(dup => ({
        nmroAjste: dup._id.nmroAjste,
        nmroSinstro: dup._id.nmroSinstro,
        cantidad: dup.count,
        ids: dup.ids.map(id => id.toString())
      }))
    };

    const archivoMapeo = path.join(__dirname, 'mapeo_duplicados_avanzado.json');
    fs.writeFileSync(archivoMapeo, JSON.stringify(mapeo, null, 2), 'utf8');
    console.log(`\n\n💾 Mapeo completo guardado en: ${archivoMapeo}`);

    // Si hay duplicados normalizados, ofrecer limpiar
    if (duplicadosNormalizados.length > 0) {
      console.log('\n⚠️ Se encontraron duplicados con formato diferente (espacios, comas, etc.)');
      console.log('   Para normalizar y eliminar duplicados, ejecuta:');
      console.log('   node mapear_eliminar_duplicados_complex.js --normalizar');
    }

    await mongoose.disconnect();
    console.log('\n✅ Búsqueda completada');

  } catch (error) {
    console.error('\n❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

buscarDuplicados();

