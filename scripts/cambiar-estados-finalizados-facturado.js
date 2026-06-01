/**
 * Script para cambiar automáticamente casos COMPLEX de estado FINALIZADO a FACTURADO
 * 
 * Este script busca todos los casos que tengan estado FINALIZADO o que NO tengan estado
 * (null, undefined, vacío) y los cambia a FACTURADO.
 * SOLO cambia el estado, no modifica otros campos.
 * 
 * Uso:
 *   node backend/scripts/cambiar-estados-finalizados-facturado.js
 * 
 * O desde la raíz del proyecto:
 *   node backend/scripts/cambiar-estados-finalizados-facturado.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import Siniestro from '../models/CasoComplex.js';
import Complex from '../models/Complex.js';
import Estado from '../models/Estado.js';

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ Error: MONGO_URI no está definido en las variables de entorno');
  process.exit(1);
}

// Función principal
async function cambiarEstadosFinalizadosAFacturado() {
  try {
    console.log('🔄 ===== INICIANDO CAMBIO DE ESTADOS =====');
    console.log('📅 Fecha:', new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }));

    // Conectar a MongoDB
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    // Paso 1: Buscar el código del estado FINALIZADO en la tabla de estados
    console.log('\n🔍 Buscando código del estado FINALIZADO en la tabla de estados...');
    const estadoFinalizado = await Estado.findOne({
      descEstdo: /FINALIZADO/i
    });

    if (!estadoFinalizado) {
      console.error('❌ ERROR: No se encontró el estado FINALIZADO en la tabla de estados');
      console.error('❌ Por favor, verificar que el estado FINALIZADO existe en la colección de estados');
      
      // Listar estados disponibles para ayudar al usuario
      console.log('\n📋 Estados disponibles en la base de datos:');
      const todosEstados = await Estado.find().sort({ codiEstdo: 1 });
      todosEstados.forEach(est => {
        console.log(`   - Código ${est.codiEstdo}: ${est.descEstdo}`);
      });
      
      await mongoose.disconnect();
      process.exit(1);
    }

    // Usar el código numérico directamente de la tabla de estados
    const codigoFinalizado = estadoFinalizado.codiEstdo; // Código numérico (ej: 4)
    console.log(`✅ Estado FINALIZADO encontrado:`);
    console.log(`   - Código: ${codigoFinalizado} (tipo: ${typeof codigoFinalizado})`);
    console.log(`   - Descripción: ${estadoFinalizado.descEstdo}`);

    // Paso 2: Buscar el código del estado FACTURADO
    console.log('\n🔍 Buscando código del estado FACTURADO...');
    const estadoFacturado = await Estado.findOne({
      descEstdo: /FACTURADO/i
    });

    if (!estadoFacturado) {
      console.error('❌ ERROR: No se encontró el estado FACTURADO en la base de datos');
      console.error('❌ Por favor, verificar que el estado FACTURADO existe en la colección de estados');
      
      // Listar estados disponibles para ayudar al usuario
      console.log('\n📋 Estados disponibles en la base de datos:');
      const todosEstados = await Estado.find().sort({ codiEstdo: 1 });
      todosEstados.forEach(est => {
        console.log(`   - Código ${est.codiEstdo}: ${est.descEstdo}`);
      });
      
      await mongoose.disconnect();
      process.exit(1);
    }

    // Usar el código numérico directamente de la tabla de estados
    const codigoFacturado = estadoFacturado.codiEstdo; // Código numérico (ej: 17)
    console.log(`✅ Estado FACTURADO encontrado:`);
    console.log(`   - Código: ${codigoFacturado} (tipo: ${typeof codigoFacturado})`);
    console.log(`   - Descripción: ${estadoFacturado.descEstdo}`);

    // Verificar que no sean el mismo código
    if (codigoFinalizado === codigoFacturado) {
      console.error('❌ ERROR: Los códigos de FINALIZADO y FACTURADO son iguales');
      console.error(`   Ambos tienen código: ${codigoFinalizado}`);
      await mongoose.disconnect();
      process.exit(1);
    }

    // Paso 3: Buscar todos los casos con estado FINALIZADO
    // IMPORTANTE: La interfaz filtra por descripcionEstado, no solo por codiEstdo
    // Buscamos casos que tengan descripcionEstado = "FINALIZADO" O codiEstdo = código FINALIZADO
    console.log(`\n🔍 Buscando casos con estado FINALIZADO...`);
    
    const db = mongoose.connection.db;
    const collection = db.collection('gsk3cAppsiniestro');
    
    // Buscar por descripcionEstado (esto es lo que usa la interfaz para filtrar)
    const casosPorDescripcion = await collection.find({ 
      descripcionEstado: /FINALIZADO/i 
    }).toArray();
    console.log(`   Casos con descripcionEstado = "FINALIZADO": ${casosPorDescripcion.length}`);
    
    // Buscar por código
    const codigoStr = String(codigoFinalizado);
    const casosPorCodigo = await collection.find({
      $or: [
        { codiEstdo: codigoStr },
        { codiEstdo: codigoFinalizado }
      ]
    }).toArray();
    console.log(`   Casos con codiEstdo = ${codigoFinalizado}: ${casosPorCodigo.length}`);
    
    // Combinar ambos resultados (usar Set para evitar duplicados)
    const casosUnicos = new Map();
    [...casosPorDescripcion, ...casosPorCodigo].forEach(caso => {
      const id = caso._id.toString();
      if (!casosUnicos.has(id)) {
        casosUnicos.set(id, caso);
      }
    });
    
    const casosFinalizados = Array.from(casosUnicos.values());
    console.log(`\n📊 Total de casos FINALIZADOS encontrados: ${casosFinalizados.length}`);
    
    // Mostrar algunos ejemplos
    if (casosFinalizados.length > 0) {
      console.log(`\n   Ejemplos (primeros 3):`);
      casosFinalizados.slice(0, 3).forEach((caso, idx) => {
        console.log(`     ${idx + 1}. Ajuste: ${caso.nmroAjste}, codiEstdo: ${caso.codiEstdo}, descripcionEstado: ${caso.descripcionEstado}`);
      });
    }

    // Paso 3b: Buscar todos los casos SIN estado (null, vacío, o no existe)
    console.log(`\n🔍 Buscando casos SIN estado (null, vacío, o no existe)...`);
    const casosSinEstado = await Siniestro.find({
      $or: [
        { codiEstdo: null },
        { codiEstdo: '' },
        { codiEstdo: { $exists: false } }
      ]
    });

    console.log(`📊 Casos SIN estado encontrados: ${casosSinEstado.length}`);

    const totalCasos = casosFinalizados.length + casosSinEstado.length;

    if (totalCasos === 0) {
      console.log('✅ No hay casos para actualizar (ni FINALIZADOS ni sin estado)');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Mostrar algunos casos que se van a actualizar
    console.log('\n📋 Casos FINALIZADOS que se actualizarán (primeros 10):');
    casosFinalizados.slice(0, 10).forEach((caso, index) => {
      console.log(`   ${index + 1}. Número Ajuste: ${caso.nmroAjste || 'N/A'}, Número Siniestro: ${caso.nmroSinstro || 'N/A'}`);
    });
    if (casosFinalizados.length > 10) {
      console.log(`   ... y ${casosFinalizados.length - 10} casos más`);
    }

    if (casosSinEstado.length > 0) {
      console.log('\n📋 Casos SIN estado que se actualizarán (primeros 10):');
      casosSinEstado.slice(0, 10).forEach((caso, index) => {
        console.log(`   ${index + 1}. Número Ajuste: ${caso.nmroAjste || 'N/A'}, Número Siniestro: ${caso.nmroSinstro || 'N/A'}`);
      });
      if (casosSinEstado.length > 10) {
        console.log(`   ... y ${casosSinEstado.length - 10} casos más`);
      }
    }

    // Paso 4: Confirmar antes de actualizar (solo si se ejecuta manualmente)
    // Si se ejecuta desde cron, proceder directamente
    if (process.env.SKIP_CONFIRMATION !== 'true' && process.stdin.isTTY) {
      console.log(`\n⚠️ Se actualizarán ${totalCasos} casos a FACTURADO:`);
      console.log(`   - ${casosFinalizados.length} casos FINALIZADOS`);
      console.log(`   - ${casosSinEstado.length} casos SIN estado`);
      console.log('⚠️ Presiona Ctrl+C para cancelar o espera 5 segundos para continuar...');
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log('\n🔄 Procediendo con la actualización...');
    }

    // Paso 5: Actualizar todos los casos FINALIZADOS a FACTURADO
    // IMPORTANTE: Actualizar tanto codiEstdo como descripcionEstado
    console.log(`\n🔄 Actualizando ${casosFinalizados.length} casos FINALIZADOS a estado FACTURADO...`);
    console.log(`   Cambiando código ${codigoFinalizado} (FINALIZADO) → ${codigoFacturado} (FACTURADO)`);
    console.log(`   Actualizando descripcionEstado: "FINALIZADO" → "${estadoFacturado.descEstdo}"`);
    
    const codigoFacturadoStr = String(codigoFacturado);
    const codigoFinalizadoStr = String(codigoFinalizado);
    
    // Actualizar usando la colección directamente
    // Buscar por descripcionEstado O por codiEstdo
    const resultadoFinalizados = await collection.updateMany(
      {
        $or: [
          { descripcionEstado: /FINALIZADO/i },  // Por descripción (lo que usa la interfaz)
          { codiEstdo: codigoFinalizadoStr },      // Por código como string
          { codiEstdo: codigoFinalizado }          // Por código como número
        ]
      },
      { 
        $set: { 
          codiEstdo: codigoFacturadoStr,  // Guardar como string (ej: "17")
          descripcionEstado: estadoFacturado.descEstdo  // Actualizar descripción también
        } 
      }
    );

    // Paso 6: Actualizar todos los casos SIN estado a FACTURADO
    // Usamos el código numérico de FACTURADO de la tabla de estados
    console.log(`\n🔄 Actualizando ${casosSinEstado.length} casos SIN estado a estado FACTURADO...`);
    console.log(`   Asignando código ${codigoFacturado} (FACTURADO) a casos sin estado`);
    
    const resultadoSinEstado = await Siniestro.updateMany(
      {
        $or: [
          { codiEstdo: null },
          { codiEstdo: '' },
          { codiEstdo: { $exists: false } }
        ]
      },
      { 
        $set: { 
          codiEstdo: codigoFacturado,  // Código numérico de FACTURADO (ej: 17)
          descripcionEstado: estadoFacturado.descEstdo
        } 
      }
    );

    const totalActualizados = resultadoFinalizados.modifiedCount + resultadoSinEstado.modifiedCount;
    const totalEncontrados = resultadoFinalizados.matchedCount + resultadoSinEstado.matchedCount;

    console.log('\n✅ ===== CAMBIO DE ESTADOS COMPLETADO =====');
    console.log(`✅ Casos FINALIZADOS encontrados: ${resultadoFinalizados.matchedCount}`);
    console.log(`✅ Casos FINALIZADOS actualizados: ${resultadoFinalizados.modifiedCount}`);
    console.log(`✅ Casos SIN estado encontrados: ${resultadoSinEstado.matchedCount}`);
    console.log(`✅ Casos SIN estado actualizados: ${resultadoSinEstado.modifiedCount}`);
    console.log(`\n📋 Resumen Total:`);
    console.log(`   - Total encontrados: ${totalEncontrados} casos`);
    console.log(`   - Total actualizados: ${totalActualizados} casos`);
    console.log(`   - De: FINALIZADO (código ${codigoFinalizado}) y casos SIN estado`);
    console.log(`   - A: FACTURADO (código ${codigoFacturado})`);

    // Desconectar de MongoDB
    await mongoose.disconnect();
    console.log('\n✅ Desconectado de MongoDB');
    console.log('✅ Script completado exitosamente');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error ejecutando cambio de estados:', error);
    console.error('📋 Stack trace:', error.stack);
    
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      console.error('❌ Error al desconectar de MongoDB:', disconnectError);
    }
    
    process.exit(1);
  }
}

// Ejecutar el script
cambiarEstadosFinalizadosAFacturado();

