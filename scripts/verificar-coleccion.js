/**
 * Script para verificar la colección directamente
 */

import 'dotenv/config';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ Error: MONGO_URI no está definido');
  process.exit(1);
}

async function verificar() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB\n');

    const db = mongoose.connection.db;
    const collection = db.collection('gsk3cAppsiniestro');

    // Contar total
    const total = await collection.countDocuments();
    console.log(`📊 Total de documentos en la colección: ${total}`);

    // Obtener algunos documentos de ejemplo
    const ejemplos = await collection.find({}).limit(5).toArray();
    console.log(`\n📋 Primeros 5 documentos:`);
    ejemplos.forEach((doc, idx) => {
      console.log(`\n   ${idx + 1}. Ajuste: ${doc.nmroAjste || 'N/A'}`);
      console.log(`      Estado: ${doc.codiEstdo} (tipo: ${typeof doc.codiEstdo})`);
      console.log(`      Estado raw: ${JSON.stringify(doc.codiEstdo)}`);
    });

    // Contar por estado
    console.log(`\n📊 Conteo por estado:`);
    const estados = await collection.aggregate([
      {
        $group: {
          _id: '$codiEstdo',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]).toArray();

    estados.forEach(est => {
      console.log(`   Estado: ${JSON.stringify(est._id)} - Cantidad: ${est.count}`);
    });

    // Buscar específicamente estado "4"
    const casos4 = await collection.find({ codiEstdo: '4' }).toArray();
    console.log(`\n🔍 Casos con codiEstdo = "4" (string): ${casos4.length}`);
    
    const casos4num = await collection.find({ codiEstdo: 4 }).toArray();
    console.log(`🔍 Casos con codiEstdo = 4 (número): ${casos4num.length}`);

    // Buscar por descripcionEstado
    const casosDescFinalizado = await collection.find({ descripcionEstado: /FINALIZADO/i }).toArray();
    console.log(`🔍 Casos con descripcionEstado que contiene "FINALIZADO": ${casosDescFinalizado.length}`);
    
    // Ver algunos ejemplos de casos con descripcionEstado
    if (casosDescFinalizado.length > 0) {
      console.log(`\n   Ejemplos de casos con descripcionEstado FINALIZADO:`);
      casosDescFinalizado.slice(0, 3).forEach((caso, idx) => {
        console.log(`     ${idx + 1}. Ajuste: ${caso.nmroAjste}, codiEstdo: ${caso.codiEstdo}, descripcionEstado: ${caso.descripcionEstado}`);
      });
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

verificar();

