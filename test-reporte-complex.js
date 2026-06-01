// Script de prueba para verificar que el reporte obtenga datos de la base de datos
import mongoose from 'mongoose';
import Siniestro from './models/CasoComplex.js';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

console.log('🧪 INICIANDO PRUEBAS DEL REPORTE COMPLEX');
console.log('🔍 Verificando conexión y datos de la base de datos\n');

// Función para conectar a MongoDB
async function connectDB() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/grupoproser';
    console.log('🔌 Conectando a MongoDB:', mongoUri);
    
    await mongoose.connect(mongoUri);
    console.log('✅ Conexión a MongoDB exitosa');
    
    // Verificar que la base de datos esté accesible
    const adminDb = mongoose.connection.db.admin();
    const dbInfo = await adminDb.listDatabases();
    console.log('📊 Bases de datos disponibles:', dbInfo.databases.map(db => db.name));
    
    return true;
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error.message);
    return false;
  }
}

// Función para verificar la colección de siniestros
async function verificarColeccionSiniestros() {
  try {
    console.log('\n🔍 Verificando colección de siniestros...');
    
    // Verificar que la colección existe
    const collections = await mongoose.connection.db.listCollections().toArray();
    const siniestrosCollection = collections.find(col => col.name === 'gsk3cAppsiniestro');
    
    if (siniestrosCollection) {
      console.log('✅ Colección gsk3cAppsiniestro encontrada');
    } else {
      console.log('❌ Colección gsk3cAppsiniestro NO encontrada');
      console.log('📋 Colecciones disponibles:', collections.map(col => col.name));
      return false;
    }
    
    // Contar documentos en la colección
    const totalSiniestros = await Siniestro.countDocuments();
    console.log(`📊 Total de siniestros en la base de datos: ${totalSiniestros}`);
    
    if (totalSiniestros === 0) {
      console.log('⚠️ La colección está vacía - no hay datos para mostrar');
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error verificando colección:', error.message);
    return false;
  }
}

// Función para verificar datos de siniestros
async function verificarDatosSiniestros() {
  try {
    console.log('\n🔍 Verificando datos de siniestros...');
    
    // Obtener algunos siniestros de ejemplo
    const siniestros = await Siniestro.find().limit(3);
    
    if (siniestros.length === 0) {
      console.log('❌ No se pudieron obtener siniestros de la base de datos');
      return false;
    }
    
    console.log(`✅ Se obtuvieron ${siniestros.length} siniestros de ejemplo`);
    
    // Verificar el primer siniestro en detalle
    const primerSiniestro = siniestros[0];
    console.log('\n📋 Primer siniestro (ID):', primerSiniestro._id);
    
    // Verificar campos críticos que debe mostrar el reporte
    const camposCriticos = [
      'nmroAjste', 'nmroSinstro', 'nombIntermediario', 'codWorkflow',
      'nmroPolza', 'codiRespnsble', 'codiAsgrdra', 'asgrBenfcro',
      'fchaAsgncion', 'fchaInspccion', 'codiEstdo', 'funcAsgrdra'
    ];
    
    console.log('\n🔍 Verificando campos críticos del reporte:');
    let camposConDatos = 0;
    
    camposCriticos.forEach(campo => {
      const valor = primerSiniestro[campo];
      if (valor !== undefined && valor !== null && valor !== '') {
        console.log(`   ✅ ${campo}: ${valor}`);
        camposConDatos++;
      } else {
        console.log(`   ❌ ${campo}: ${valor} (vacío o undefined)`);
      }
    });
    
    console.log(`\n📊 Resumen: ${camposConDatos}/${camposCriticos.length} campos tienen datos`);
    
    // Verificar si hay campos vacíos problemáticos
    if (camposConDatos < camposCriticos.length) {
      console.log('\n⚠️ PROBLEMA DETECTADO: Algunos campos están vacíos');
      console.log('💡 Esto explicaría por qué el reporte no muestra información completa');
    } else {
      console.log('\n✅ Todos los campos críticos tienen datos');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error verificando datos:', error.message);
    return false;
  }
}

// Función para simular la consulta del reporte
async function simularConsultaReporte() {
  try {
    console.log('\n🔍 Simulando consulta del reporte...');
    
    // Simular la consulta que hace el reporte (similar a getSiniestrosEnriquecidos)
    const siniestros = await Siniestro.find()
      .sort({ fchaAsgncion: -1 })
      .limit(5);
    
    console.log(`✅ Consulta simulada exitosa - ${siniestros.length} siniestros obtenidos`);
    
    // Verificar que los datos estén en el formato esperado
    console.log('\n📋 Verificando formato de datos para el reporte:');
    
    siniestros.forEach((siniestro, index) => {
      console.log(`\n📊 Siniestro ${index + 1}:`);
      console.log(`   ID: ${siniestro._id}`);
      console.log(`   Número Siniestro: ${siniestro.nmroSinstro || 'VACÍO'}`);
      console.log(`   Código Workflow: ${siniestro.codWorkflow || 'VACÍO'}`);
      console.log(`   Responsable: ${siniestro.codiRespnsble || 'VACÍO'}`);
      console.log(`   Asegurado: ${siniestro.asgrBenfcro || 'VACÍO'}`);
      console.log(`   Fecha Asignación: ${siniestro.fchaAsgncion || 'VACÍO'}`);
      
      // Contar campos vacíos
      const camposVacios = [
        'nmroSinstro', 'codWorkflow', 'codiRespnsble', 
        'asgrBenfcro', 'fchaAsgncion'
      ].filter(campo => !siniestro[campo]);
      
      if (camposVacios.length > 0) {
        console.log(`   ⚠️ Campos vacíos: ${camposVacios.join(', ')}`);
      } else {
        console.log(`   ✅ Todos los campos principales tienen datos`);
      }
    });
    
    return true;
  } catch (error) {
    console.error('❌ Error simulando consulta:', error.message);
    return false;
  }
}

// Función para verificar si hay datos de prueba
async function verificarDatosPrueba() {
  try {
    console.log('\n🔍 Verificando si hay datos de prueba...');
    
    // Buscar siniestros con datos específicos de prueba
    const siniestrosPrueba = await Siniestro.find({
      $or: [
        { nmroSinstro: { $regex: /PRUEBA|TEST|SIN-/, $options: 'i' } },
        { asgrBenfcro: { $regex: /PRUEBA|TEST|CLIENTE/, $options: 'i' } },
        { codWorkflow: { $regex: /WF-|WORKFLOW/, $options: 'i' } }
      ]
    });
    
    if (siniestrosPrueba.length > 0) {
      console.log(`✅ Se encontraron ${siniestrosPrueba.length} siniestros de prueba`);
      siniestrosPrueba.forEach(s => {
        console.log(`   📋 ${s.nmroSinstro} - ${s.asgrBenfcro} - ${s.codWorkflow}`);
      });
    } else {
      console.log('⚠️ No se encontraron siniestros de prueba');
      console.log('💡 Esto podría indicar que no hay datos recientes o de prueba');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error verificando datos de prueba:', error.message);
    return false;
  }
}

// Función principal de pruebas
async function ejecutarPruebasReporte() {
  try {
    // 1. Conectar a la base de datos
    const conexionExitosa = await connectDB();
    if (!conexionExitosa) {
      console.log('\n💥 No se puede continuar sin conexión a MongoDB');
      return;
    }
    
    // 2. Verificar colección
    const coleccionOk = await verificarColeccionSiniestros();
    if (!coleccionOk) {
      console.log('\n💥 Problema con la colección de siniestros');
      return;
    }
    
    // 3. Verificar datos
    const datosOk = await verificarDatosSiniestros();
    if (!datosOk) {
      console.log('\n💥 Problema con los datos de siniestros');
      return;
    }
    
    // 4. Simular consulta del reporte
    const consultaOk = await simularConsultaReporte();
    if (!consultaOk) {
      console.log('\n💥 Problema con la consulta del reporte');
      return;
    }
    
    // 5. Verificar datos de prueba
    await verificarDatosPrueba();
    
    console.log('\n🎯 RESUMEN DE PRUEBAS DEL REPORTE:');
    console.log('✅ Conexión a MongoDB: EXITOSA');
    console.log('✅ Colección de siniestros: VERIFICADA');
    console.log('✅ Datos de siniestros: VERIFICADOS');
    console.log('✅ Consulta del reporte: SIMULADA');
    
    console.log('\n💡 RECOMENDACIONES:');
    console.log('1. Si hay campos vacíos, verificar el formulario de creación');
    console.log('2. Si no hay datos, crear un caso de prueba');
    console.log('3. Verificar que el frontend esté usando los nombres correctos de campos');
    
  } catch (error) {
    console.error('\n💥 Error general en las pruebas:', error.message);
  } finally {
    // Cerrar conexión
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('\n🔌 Conexión a MongoDB cerrada');
    }
  }
}

// Ejecutar las pruebas
ejecutarPruebasReporte();

