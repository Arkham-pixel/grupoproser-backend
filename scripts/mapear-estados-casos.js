/**
 * Script para mapear y verificar estados y casos en la base de datos
 * 
 * Este script muestra:
 * - Todos los estados disponibles
 * - Cantidad de casos por cada estado
 * - Casos sin estado
 * - Detalles de algunos casos de ejemplo
 * 
 * Uso:
 *   node backend/scripts/mapear-estados-casos.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import Siniestro from '../models/CasoComplex.js';
import Estado from '../models/Estado.js';

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ Error: MONGO_URI no está definido en las variables de entorno');
  process.exit(1);
}

// Función principal
async function mapearEstadosYCasos() {
  try {
    console.log('🔄 ===== INICIANDO MAPEO DE ESTADOS Y CASOS =====');
    console.log('📅 Fecha:', new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }));

    // Conectar a MongoDB
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB\n');

    // Paso 1: Obtener todos los estados
    console.log('📋 ===== ESTADOS DISPONIBLES =====');
    const todosEstados = await Estado.find().sort({ codiEstdo: 1 });
    console.log(`Total de estados: ${todosEstados.length}\n`);
    
    todosEstados.forEach(est => {
      console.log(`   Código: ${est.codiEstdo} (tipo: ${typeof est.codiEstdo}) - Descripción: ${est.descEstdo}`);
    });

    // Paso 2: Buscar estado FINALIZADO específicamente
    console.log('\n🔍 ===== BUSCANDO ESTADO FINALIZADO =====');
    const estadoFinalizadoNum = await Estado.findOne({ codiEstdo: 4 });
    const estadoFinalizadoStr = await Estado.findOne({ codiEstdo: '4' });
    const estadoFinalizadoDesc = await Estado.findOne({ descEstdo: /FINALIZADO/i });
    
    console.log('Búsqueda por código numérico 4:', estadoFinalizadoNum ? `✅ Encontrado: ${estadoFinalizadoNum.descEstdo}` : '❌ No encontrado');
    console.log('Búsqueda por código string "4":', estadoFinalizadoStr ? `✅ Encontrado: ${estadoFinalizadoStr.descEstdo}` : '❌ No encontrado');
    console.log('Búsqueda por descripción "FINALIZADO":', estadoFinalizadoDesc ? `✅ Encontrado: código ${estadoFinalizadoDesc.codiEstdo}` : '❌ No encontrado');

    // Paso 3: Contar casos por estado
    console.log('\n📊 ===== CONTEO DE CASOS POR ESTADO =====');
    
    // Obtener todos los casos únicos con sus estados
    const casosPorEstado = await Siniestro.aggregate([
      {
        $group: {
          _id: '$codiEstdo',
          count: { $sum: 1 },
          tipos: { $addToSet: { $type: '$codiEstdo' } }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    console.log(`Total de grupos de estado: ${casosPorEstado.length}\n`);
    
    for (const grupo of casosPorEstado) {
      const estadoCodigo = grupo._id;
      const cantidad = grupo.count;
      const tipos = grupo.tipos.join(', ');
      
      // Buscar la descripción del estado
      let descripcion = 'Estado no encontrado';
      if (estadoCodigo !== null && estadoCodigo !== undefined && estadoCodigo !== '') {
        try {
          // Intentar convertir a número si es posible
          const estadoNum = !isNaN(estadoCodigo) ? Number(estadoCodigo) : null;
          const estado = await Estado.findOne({ 
            $or: [
              { codiEstdo: estadoCodigo },
              ...(estadoNum !== null ? [{ codiEstdo: estadoNum }, { codiEstdo: String(estadoCodigo) }] : [])
            ]
          });
          if (estado) {
            descripcion = estado.descEstdo;
          } else {
            descripcion = `Valor inválido: "${estadoCodigo}"`;
          }
        } catch (error) {
          descripcion = `Error al buscar: "${estadoCodigo}"`;
        }
      } else {
        descripcion = 'SIN ESTADO';
      }
      
      console.log(`   Estado: ${estadoCodigo === null ? 'null' : estadoCodigo === undefined ? 'undefined' : estadoCodigo === '' ? '(vacío)' : estadoCodigo} (tipo: ${tipos})`);
      console.log(`   Cantidad: ${cantidad} casos`);
      console.log(`   Descripción: ${descripcion}`);
      
      // Mostrar algunos casos de ejemplo
      const casosEjemplo = await Siniestro.find({ codiEstdo: estadoCodigo }).limit(3);
      if (casosEjemplo.length > 0) {
        console.log(`   Ejemplos:`);
        casosEjemplo.forEach((caso, idx) => {
          console.log(`     ${idx + 1}. Ajuste: ${caso.nmroAjste || 'N/A'}, Siniestro: ${caso.nmroSinstro || 'N/A'}, Estado: ${caso.codiEstdo}`);
        });
      }
      console.log('');
    }

    // Paso 4: Buscar casos con estado FINALIZADO de diferentes formas
    console.log('🔍 ===== BUSCANDO CASOS FINALIZADOS (DIFERENTES FORMAS) =====');
    
    // Buscar con código numérico 4
    const casosFinalizadoNum = await Siniestro.find({ codiEstdo: 4 });
    console.log(`Casos con codiEstdo = 4 (número): ${casosFinalizadoNum.length}`);
    
    // Buscar con código string "4"
    const casosFinalizadoStr = await Siniestro.find({ codiEstdo: '4' });
    console.log(`Casos con codiEstdo = "4" (string): ${casosFinalizadoStr.length}`);
    
    // Buscar con código que coincida con el estado encontrado
    if (estadoFinalizadoDesc) {
      const codigoFinalizado = estadoFinalizadoDesc.codiEstdo;
      const casosFinalizado = await Siniestro.find({ 
        $or: [
          { codiEstdo: codigoFinalizado },
          { codiEstdo: Number(codigoFinalizado) },
          { codiEstdo: String(codigoFinalizado) }
        ]
      });
      console.log(`Casos con codiEstdo = ${codigoFinalizado} (del estado encontrado): ${casosFinalizado.length}`);
      
      if (casosFinalizado.length > 0) {
        console.log('\n   Primeros 10 casos FINALIZADOS:');
        casosFinalizado.slice(0, 10).forEach((caso, idx) => {
          console.log(`     ${idx + 1}. Ajuste: ${caso.nmroAjste || 'N/A'}, Siniestro: ${caso.nmroSinstro || 'N/A'}, Estado: ${caso.codiEstdo} (tipo: ${typeof caso.codiEstdo})`);
        });
      }
    }

    // Paso 5: Casos sin estado
    console.log('\n🔍 ===== CASOS SIN ESTADO =====');
    const casosSinEstado = await Siniestro.find({
      $or: [
        { codiEstdo: null },
        { codiEstdo: '' },
        { codiEstdo: { $exists: false } }
      ]
    });
    console.log(`Total de casos sin estado: ${casosSinEstado.length}`);
    if (casosSinEstado.length > 0) {
      console.log('\n   Primeros 10 casos sin estado:');
      casosSinEstado.slice(0, 10).forEach((caso, idx) => {
        console.log(`     ${idx + 1}. Ajuste: ${caso.nmroAjste || 'N/A'}, Siniestro: ${caso.nmroSinstro || 'N/A'}, Estado: ${caso.codiEstdo}`);
      });
    }

    // Paso 6: Estadísticas generales
    console.log('\n📊 ===== ESTADÍSTICAS GENERALES =====');
    const totalCasos = await Siniestro.countDocuments();
    console.log(`Total de casos en la base de datos: ${totalCasos}`);
    
    const casosConEstado = await Siniestro.countDocuments({
      codiEstdo: { $exists: true, $ne: null, $ne: '' }
    });
    console.log(`Casos con estado: ${casosConEstado}`);
    console.log(`Casos sin estado: ${totalCasos - casosConEstado}`);

    // Desconectar de MongoDB
    await mongoose.disconnect();
    console.log('\n✅ Desconectado de MongoDB');
    console.log('✅ Script completado exitosamente');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error ejecutando mapeo:', error);
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
mapearEstadosYCasos();

