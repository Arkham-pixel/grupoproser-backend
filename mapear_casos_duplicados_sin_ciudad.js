import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from './models/Complex.js';

/**
 * Script para mapear y analizar casos duplicados y casos sin ciudad
 * Identifica casos con comas en nmroAjste (formato incorrecto)
 */

async function mapearCasos() {
  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Conectado a MongoDB\n');

    // 1. Buscar casos con comas en nmroAjste
    console.log('🔍 Buscando casos con comas en nmroAjste...');
    const casosConComas = await Complex.find({
      nmroAjste: { $regex: /,/ }
    }).lean();
    
    console.log(`📊 Casos con comas encontrados: ${casosConComas.length}\n`);

    // 2. Buscar casos sin ciudad
    console.log('🔍 Buscando casos sin ciudad...');
    const casosSinCiudad = await Complex.find({
      $or: [
        { ciudadSiniestro: { $exists: false } },
        { ciudadSiniestro: null },
        { ciudadSiniestro: '' }
      ]
    }).lean();
    
    console.log(`📊 Casos sin ciudad encontrados: ${casosSinCiudad.length}\n`);

    // 3. Casos con comas Y sin ciudad (intersección)
    const casosConComasIds = new Set(casosConComas.map(c => c._id.toString()));
    const casosSinCiudadIds = new Set(casosSinCiudad.map(c => c._id.toString()));
    
    const casosConComasYSinCiudad = casosConComas.filter(c => 
      casosSinCiudadIds.has(c._id.toString())
    );

    // 4. Buscar duplicados por nmroAjste (normalizado sin comas)
    console.log('🔍 Buscando duplicados por nmroAjste (normalizado)...\n');
    
    const todosLosCasos = await Complex.find({}).lean();
    const casosPorNumero = new Map();
    
    todosLosCasos.forEach(caso => {
      // Normalizar: quitar comas y espacios
      const numeroNormalizado = String(caso.nmroAjste || '').replace(/,/g, '').replace(/\s/g, '').trim();
      
      if (!numeroNormalizado) return;
      
      if (!casosPorNumero.has(numeroNormalizado)) {
        casosPorNumero.set(numeroNormalizado, []);
      }
      casosPorNumero.get(numeroNormalizado).push(caso);
    });

    // Encontrar duplicados
    const duplicados = [];
    for (const [numero, casos] of casosPorNumero.entries()) {
      if (casos.length > 1) {
        duplicados.push({
          numeroNormalizado: numero,
          cantidad: casos.length,
          casos: casos.map(c => ({
            _id: c._id,
            nmroAjste: c.nmroAjste,
            ciudadSiniestro: c.ciudadSiniestro || 'SIN CIUDAD',
            asgrBenfcro: c.asgrBenfcro || 'SIN ASEGURADO',
            tieneComas: String(c.nmroAjste || '').includes(','),
            createdAt: c.createdAt,
            updatedAt: c.updatedAt
          }))
        });
      }
    }

    // 5. Generar reporte
    console.log('='.repeat(80));
    console.log('📊 REPORTE DE CASOS DUPLICADOS Y SIN CIUDAD');
    console.log('='.repeat(80));
    
    console.log(`\n1️⃣ CASOS CON COMAS EN nmroAjste: ${casosConComas.length}`);
    if (casosConComas.length > 0) {
      console.log('\n   Ejemplos (primeros 10):');
      casosConComas.slice(0, 10).forEach((caso, idx) => {
        console.log(`   ${idx + 1}. ${caso.nmroAjste} | Ciudad: ${caso.ciudadSiniestro || 'SIN CIUDAD'} | Asegurado: ${caso.asgrBenfcro || 'N/A'}`);
      });
      if (casosConComas.length > 10) {
        console.log(`   ... y ${casosConComas.length - 10} más`);
      }
    }

    console.log(`\n2️⃣ CASOS SIN CIUDAD: ${casosSinCiudad.length}`);
    if (casosSinCiudad.length > 0) {
      console.log('\n   Ejemplos (primeros 10):');
      casosSinCiudad.slice(0, 10).forEach((caso, idx) => {
        const tieneComas = String(caso.nmroAjste || '').includes(',');
        console.log(`   ${idx + 1}. ${caso.nmroAjste} | ${tieneComas ? '⚠️ TIENE COMAS' : '✅ Sin comas'} | Asegurado: ${caso.asgrBenfcro || 'N/A'}`);
      });
      if (casosSinCiudad.length > 10) {
        console.log(`   ... y ${casosSinCiudad.length - 10} más`);
      }
    }

    console.log(`\n3️⃣ CASOS CON COMAS Y SIN CIUDAD (CANDIDATOS A ELIMINAR): ${casosConComasYSinCiudad.length}`);
    if (casosConComasYSinCiudad.length > 0) {
      console.log('\n   Lista completa:');
      casosConComasYSinCiudad.forEach((caso, idx) => {
        console.log(`   ${idx + 1}. ${caso.nmroAjste} | Asegurado: ${caso.asgrBenfcro || 'N/A'} | ID: ${caso._id}`);
      });
    }

    console.log(`\n4️⃣ DUPLICADOS POR nmroAjste (normalizado): ${duplicados.length} grupos`);
    if (duplicados.length > 0) {
      console.log('\n   Grupos de duplicados (primeros 10):');
      duplicados.slice(0, 10).forEach((dup, idx) => {
        console.log(`\n   Grupo ${idx + 1}: Número normalizado "${dup.numeroNormalizado}" (${dup.cantidad} casos)`);
        dup.casos.forEach((c, cIdx) => {
          console.log(`      ${cIdx + 1}. ${c.nmroAjste} | Ciudad: ${c.ciudadSiniestro} | ${c.tieneComas ? '⚠️ TIENE COMAS' : '✅ Sin comas'} | Creado: ${c.createdAt}`);
        });
      });
      if (duplicados.length > 10) {
        console.log(`\n   ... y ${duplicados.length - 10} grupos más`);
      }
    }

    // 6. Análisis de casos a eliminar
    console.log('\n' + '='.repeat(80));
    console.log('🎯 ANÁLISIS: CASOS CANDIDATOS A ELIMINAR');
    console.log('='.repeat(80));

    // Casos con comas que son duplicados
    const casosAEliminar = [];
    
    for (const dup of duplicados) {
      // En cada grupo de duplicados, identificar cuáles tienen comas
      const conComas = dup.casos.filter(c => c.tieneComas);
      const sinComas = dup.casos.filter(c => !c.tieneComas);
      
      if (conComas.length > 0 && sinComas.length > 0) {
        // Si hay casos con comas y sin comas, los con comas son candidatos a eliminar
        conComas.forEach(c => {
          casosAEliminar.push({
            _id: c._id,
            nmroAjste: c.nmroAjste,
            numeroNormalizado: dup.numeroNormalizado,
            razon: 'Duplicado con formato incorrecto (tiene comas)',
            tieneCiudad: c.ciudadSiniestro !== 'SIN CIUDAD'
          });
        });
      }
    }

    // También agregar casos con comas y sin ciudad que no tienen duplicado
    casosConComasYSinCiudad.forEach(caso => {
      const numeroNormalizado = String(caso.nmroAjste || '').replace(/,/g, '').trim();
      const tieneDuplicado = casosPorNumero.has(numeroNormalizado) && 
                             casosPorNumero.get(numeroNormalizado).length > 1;
      
      if (!tieneDuplicado) {
        casosAEliminar.push({
          _id: caso._id,
          nmroAjste: caso.nmroAjste,
          numeroNormalizado: numeroNormalizado,
          razon: 'Formato incorrecto (tiene comas) y sin ciudad',
          tieneCiudad: false
        });
      }
    });

    console.log(`\n📋 Total casos candidatos a eliminar: ${casosAEliminar.length}`);
    
    const conCiudad = casosAEliminar.filter(c => c.tieneCiudad).length;
    const sinCiudad = casosAEliminar.filter(c => !c.tieneCiudad).length;
    
    console.log(`   - Con ciudad: ${conCiudad}`);
    console.log(`   - Sin ciudad: ${sinCiudad}`);

    if (casosAEliminar.length > 0) {
      console.log('\n   Lista de casos a eliminar:');
      casosAEliminar.forEach((c, idx) => {
        console.log(`   ${idx + 1}. ${c.nmroAjste} | ${c.razon} | ${c.tieneCiudad ? '✅ Tiene ciudad' : '❌ Sin ciudad'}`);
      });
    }

    // 7. Guardar reporte en archivo
    const fs = await import('fs');
    const reporte = {
      fecha: new Date().toISOString(),
      resumen: {
        casosConComas: casosConComas.length,
        casosSinCiudad: casosSinCiudad.length,
        casosConComasYSinCiudad: casosConComasYSinCiudad.length,
        gruposDuplicados: duplicados.length,
        casosAEliminar: casosAEliminar.length
      },
      casosConComas: casosConComas.map(c => ({
        _id: c._id.toString(),
        nmroAjste: c.nmroAjste,
        ciudadSiniestro: c.ciudadSiniestro,
        asgrBenfcro: c.asgrBenfcro
      })),
      casosSinCiudad: casosSinCiudad.map(c => ({
        _id: c._id.toString(),
        nmroAjste: c.nmroAjste,
        asgrBenfcro: c.asgrBenfcro,
        tieneComas: String(c.nmroAjste || '').includes(',')
      })),
      casosConComasYSinCiudad: casosConComasYSinCiudad.map(c => ({
        _id: c._id.toString(),
        nmroAjste: c.nmroAjste,
        asgrBenfcro: c.asgrBenfcro
      })),
      duplicados: duplicados.map(dup => ({
        numeroNormalizado: dup.numeroNormalizado,
        cantidad: dup.cantidad,
        casos: dup.casos
      })),
      casosAEliminar: casosAEliminar
    };

    const nombreArchivo = `reporte_casos_duplicados_${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(nombreArchivo, JSON.stringify(reporte, null, 2));
    console.log(`\n💾 Reporte guardado en: ${nombreArchivo}`);

    // 8. Generar script de eliminación
    const idsAEliminar = casosAEliminar.map(c => c._id.toString());
    const scriptEliminacion = `import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from './models/Complex.js';

const IDs_A_ELIMINAR = ${JSON.stringify(idsAEliminar, null, 2)};

async function eliminar() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado a MongoDB');
    
    const resultado = await Complex.deleteMany({ 
      _id: { $in: IDs_A_ELIMINAR.map(id => new mongoose.Types.ObjectId(id)) }
    });
    
    console.log(\`✅ Eliminados \${resultado.deletedCount} casos\`);
    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
  }
}

eliminar();
`;

    const nombreScript = 'eliminar_casos_duplicados.js';
    fs.writeFileSync(nombreScript, scriptEliminacion);
    console.log(`📝 Script de eliminación generado: ${nombreScript}`);
    console.log(`\n⚠️  Para eliminar los casos, ejecuta: node ${nombreScript}`);

    await mongoose.disconnect();
    console.log('\n✅ Proceso completado');

  } catch (error) {
    console.error('\n❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

mapearCasos();


