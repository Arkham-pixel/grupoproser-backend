// Script de prueba para verificar la estructura del modelo sin MongoDB
import Siniestro from './models/CasoComplex.js';

console.log('🧪 INICIANDO PRUEBAS DE ESTRUCTURA DEL MODELO (SIN MONGODB)\n');

// Verificar que el modelo se importe correctamente
console.log('🔍 Verificando importación del modelo...');
if (Siniestro) {
  console.log('✅ Modelo Siniestro importado correctamente');
  console.log('   Tipo:', typeof Siniestro);
  console.log('   Nombre:', Siniestro.modelName);
} else {
  console.error('❌ Error: No se pudo importar el modelo Siniestro');
  process.exit(1);
}

// Verificar el esquema del modelo
console.log('\n🔍 Verificando esquema del modelo...');
try {
  const schema = Siniestro.schema;
  if (schema) {
    console.log('✅ Esquema del modelo disponible');
    console.log('   Campos definidos:', Object.keys(schema.paths).length);
    
    // Listar campos principales
    const camposPrincipales = [
      'nmroAjste', 'codiRespnsble', 'codiAsgrdra', 'nmroSinstro',
      'codWorkflow', 'funcAsgrdra', 'fchaAsgncion', 'asgrBenfcro',
      'tipoDucumento', 'numDocumento', 'tipoPoliza', 'nmroPolza',
      'amprAfctdo', 'fchaSinstro', 'descSinstro', 'ciudadSiniestro',
      'fchaInspccion', 'codiEstdo', 'fchaContIni'
    ];
    
    console.log('\n📋 Campos principales requeridos:');
    camposPrincipales.forEach(campo => {
      const path = schema.paths[campo];
      if (path) {
        console.log(`   ✅ ${campo}: ${path.instance}`);
      } else {
        console.log(`   ❌ ${campo}: NO DEFINIDO`);
      }
    });
    
    // Verificar campos adicionales
    const camposAdicionales = [
      'obse_cont_ini', 'anex_cont_ini', 'obse_inspccion', 'anex_acta_inspccion',
      'anex_sol_doc', 'obse_soli_docu', 'anxo_inf_prelim', 'obse_info_prelm',
      'anxo_info_fnal', 'obse_info_fnal', 'anxo_repo_acti', 'obse_repo_acti',
      'anxo_factra', 'anxo_honorarios', 'anxo_honorariosdefinit', 'anxo_autorizacion',
      'obse_comprmsi', 'obse_segmnto'
    ];
    
    console.log('\n📋 Campos adicionales:');
    camposAdicionales.forEach(campo => {
      const path = schema.paths[campo];
      if (path) {
        console.log(`   ✅ ${campo}: ${path.instance}`);
      } else {
        console.log(`   ❌ ${campo}: NO DEFINIDO`);
      }
    });
    
    // Verificar campos de fecha
    const camposFecha = [
      'fcha_soli_docu', 'fcha_info_prelm', 'fcha_info_fnal', 'fcha_repo_acti',
      'fcha_ult_segui', 'fcha_act_segui', 'fcha_finqto_indem', 'fcha_factra', 'fcha_ult_revi'
    ];
    
    console.log('\n📋 Campos de fecha:');
    camposFecha.forEach(campo => {
      const path = schema.paths[campo];
      if (path) {
        console.log(`   ✅ ${campo}: ${path.instance}`);
      } else {
        console.log(`   ❌ ${campo}: NO DEFINIDO`);
      }
    });
    
    // Verificar campos numéricos
    const camposNumericos = [
      'dias_transcrrdo', 'vlor_resrva', 'vlor_reclmo', 'monto_indmzar',
      'vlor_servcios', 'vlor_gastos', 'total', 'total_general', 'total_pagado',
      'iva', 'reteiva', 'retefuente', 'reteica', 'porc_iva', 'porc_reteiva',
      'porc_retefuente', 'porc_reteica'
    ];
    
    console.log('\n📋 Campos numéricos:');
    camposNumericos.forEach(campo => {
      const path = schema.paths[campo];
      if (path) {
        console.log(`   ✅ ${campo}: ${path.instance}`);
      } else {
        console.log(`   ❌ ${campo}: NO DEFINIDO`);
      }
    });
    
    // Verificar campo de historial
    const historialPath = schema.paths.historialDocs;
    if (historialPath) {
      console.log('\n📋 Campo historialDocs:');
      console.log(`   ✅ historialDocs: ${historialPath.instance}`);
      if (historialPath.instance === 'Array') {
        console.log('   ✅ Es un array (correcto para documentos múltiples)');
      }
    } else {
      console.log('\n❌ Campo historialDocs: NO DEFINIDO');
    }
    
  } else {
    console.error('❌ Error: No se pudo acceder al esquema del modelo');
  }
} catch (error) {
  console.error('❌ Error verificando esquema:', error.message);
}

// Verificar que el modelo tenga los métodos necesarios
console.log('\n🔍 Verificando métodos del modelo...');
const metodosRequeridos = ['find', 'findById', 'create', 'save', 'findByIdAndUpdate', 'findByIdAndDelete'];
metodosRequeridos.forEach(metodo => {
  if (typeof Siniestro[metodo] === 'function') {
    console.log(`   ✅ ${metodo}: Disponible`);
  } else {
    console.log(`   ❌ ${metodo}: NO DISPONIBLE`);
  }
});

// Verificar configuración de la colección
console.log('\n🔍 Verificando configuración de la colección...');
try {
  const collectionName = Siniestro.collection.name;
  console.log(`   ✅ Nombre de colección: ${collectionName}`);
  
  if (collectionName === 'gsk3cAppsiniestro') {
    console.log('   ✅ Nombre de colección correcto');
  } else {
    console.log(`   ⚠️ Nombre de colección inesperado: ${collectionName}`);
  }
} catch (error) {
  console.log('   ⚠️ No se pudo verificar el nombre de la colección (normal sin conexión)');
}

console.log('\n🎯 RESUMEN DE VERIFICACIÓN:');
console.log('✅ Este script verifica la estructura del modelo sin necesidad de MongoDB');
console.log('✅ Si todos los campos están marcados como ✅, el modelo está correctamente definido');
console.log('✅ Para probar la funcionalidad completa, necesitas MongoDB corriendo');
console.log('\n💡 Para ejecutar las pruebas completas:');
console.log('   1. Asegúrate de que MongoDB esté corriendo');
console.log('   2. Crea un archivo .env con MONGO_URI=mongodb://localhost:27017/grupoproser');
console.log('   3. Ejecuta: node test-caso-complex.js');

console.log('\n🏁 Verificación de estructura completada');

