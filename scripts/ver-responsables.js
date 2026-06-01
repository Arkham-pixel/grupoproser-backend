/**
 * Script para ver todos los responsables y sus nombres
 */

import mongoose from 'mongoose';
import Responsable from '../models/Responsable.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Configurar __dirname para ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar .env desde el directorio backend
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const verResponsables = async () => {
  try {
    console.log('🔍 Conectando a MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado a MongoDB\n');

    const responsables = await Responsable.find({}).sort({ nmbrRespnsble: 1 });
    console.log(`📋 Total de responsables: ${responsables.length}\n`);

    console.log('Lista de responsables:\n');
    responsables.forEach((resp, index) => {
      console.log(`${index + 1}. ${resp.nmbrRespnsble}`);
      console.log(`   Código: ${resp.codiRespnsble}`);
      console.log(`   Email: ${resp.email || 'N/A'}`);
      console.log('');
    });

    await mongoose.disconnect();
    console.log('\n✅ Desconectado de MongoDB');
    
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

verResponsables();
