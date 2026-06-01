/**
 * Script para verificar cómo están guardados los estados en los casos
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

async function verificarEstados() {
  try {
    console.log('🔄 ===== VERIFICANDO ESTADOS EN CASOS =====');
    
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB\n');

    // Buscar estado FINALIZADO
    const estadoFinalizado = await Estado.findOne({ descEstdo: /FINALIZADO/i });
    if (!estadoFinalizado) {
      console.error('❌ No se encontró estado FINALIZADO');
      process.exit(1);
    }
    
    const codigoFinalizado = estadoFinalizado.codiEstdo;
    console.log(`📋 Estado FINALIZADO: código ${codigoFinalizado} (tipo: ${typeof codigoFinalizado})\n`);

    // Buscar casos de diferentes formas
    console.log('🔍 Buscando casos FINALIZADOS de diferentes formas:\n');
    
    // Como número
    const casosNum = await Siniestro.find({ codiEstdo: codigoFinalizado });
    console.log(`1. Buscando con codiEstdo = ${codigoFinalizado} (número): ${casosNum.length} casos`);
    
    // Como string
    const casosStr = await Siniestro.find({ codiEstdo: String(codigoFinalizado) });
    console.log(`2. Buscando con codiEstdo = "${String(codigoFinalizado)}" (string): ${casosStr.length} casos`);
    
    // Con $or
    const casosOr = await Siniestro.find({
      $or: [
        { codiEstdo: codigoFinalizado },
        { codiEstdo: String(codigoFinalizado) }
      ]
    });
    console.log(`3. Buscando con $or (número o string): ${casosOr.length} casos\n`);

    // Ver algunos casos de ejemplo para ver qué tipo tienen
    console.log('📊 Muestra de casos (primeros 5):');
    const muestra = await Siniestro.find().limit(5);
    muestra.forEach((caso, idx) => {
      console.log(`   ${idx + 1}. Ajuste: ${caso.nmroAjste}, Estado: ${caso.codiEstdo} (tipo: ${typeof caso.codiEstdo}, valor: ${JSON.stringify(caso.codiEstdo)})`);
    });

    // Ver casos que tienen el código como string "4"
    console.log('\n🔍 Casos con estado como string "4":');
    const casosString4 = await Siniestro.find({ codiEstdo: '4' });
    console.log(`   Encontrados: ${casosString4.length} casos`);
    if (casosString4.length > 0) {
      console.log('   Ejemplos:');
      casosString4.slice(0, 3).forEach((caso, idx) => {
        console.log(`     ${idx + 1}. Ajuste: ${caso.nmroAjste}, Estado: "${caso.codiEstdo}"`);
      });
    }

    // Ver casos que tienen el código como número 4
    console.log('\n🔍 Casos con estado como número 4:');
    const casosNum4 = await Siniestro.find({ codiEstdo: 4 });
    console.log(`   Encontrados: ${casosNum4.length} casos`);
    if (casosNum4.length > 0) {
      console.log('   Ejemplos:');
      casosNum4.slice(0, 3).forEach((caso, idx) => {
        console.log(`     ${idx + 1}. Ajuste: ${caso.nmroAjste}, Estado: ${caso.codiEstdo}`);
      });
    }

    // Agregación para ver todos los valores únicos de codiEstdo y sus tipos
    console.log('\n📊 Análisis de todos los valores de codiEstdo:');
    const valoresEstados = await Siniestro.aggregate([
      {
        $group: {
          _id: '$codiEstdo',
          count: { $sum: 1 },
          tipos: { $addToSet: { $type: '$codiEstdo' } }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    console.log(`\n   Total de valores únicos: ${valoresEstados.length}`);
    for (const v of valoresEstados) {
      const estadoCodigo = v._id;
      const cantidad = v.count;
      const tipos = v.tipos.join(', ');
      
      // Buscar descripción
      let desc = 'Sin descripción';
      if (estadoCodigo !== null && estadoCodigo !== undefined && estadoCodigo !== '') {
        try {
          const estado = await Estado.findOne({
            $or: [
              { codiEstdo: estadoCodigo },
              { codiEstdo: Number(estadoCodigo) },
              { codiEstdo: String(estadoCodigo) }
            ]
          });
          if (estado) desc = estado.descEstdo;
        } catch (e) {
          desc = 'Error al buscar';
        }
      }
      
      console.log(`   - Valor: ${JSON.stringify(estadoCodigo)} (tipo: ${tipos}) - Cantidad: ${cantidad} - Descripción: ${desc}`);
    }

    await mongoose.disconnect();
    console.log('\n✅ Verificación completada');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

verificarEstados();

