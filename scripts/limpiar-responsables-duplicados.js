/**
 * Script para identificar y limpiar responsables duplicados
 * Este script encuentra responsables con nombres similares pero diferente capitalización
 * y los normaliza para evitar duplicados.
 */

import mongoose from 'mongoose';
import Responsable from '../models/Responsable.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Configurar __dirname para ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar .env desde el directorio backend (un nivel arriba de scripts)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Función para normalizar nombres
const normalizarNombre = (nombre) => {
  if (!nombre) return '';
  return nombre
    .toLowerCase()
    .split(' ')
    .map(palabra => palabra.charAt(0).toUpperCase() + palabra.slice(1))
    .join(' ')
    .trim();
};

const limpiarDuplicados = async () => {
  try {
    console.log('🔍 Conectando a MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    console.log('\n📊 Analizando responsables...');
    const responsables = await Responsable.find({}).sort({ nmbrRespnsble: 1 });
    console.log(`📋 Total de responsables encontrados: ${responsables.length}`);

    // Agrupar por nombre normalizado
    const grupos = new Map();
    
    responsables.forEach(resp => {
      const nombreNormalizado = normalizarNombre(resp.nmbrRespnsble);
      if (!grupos.has(nombreNormalizado)) {
        grupos.set(nombreNormalizado, []);
      }
      grupos.get(nombreNormalizado).push(resp);
    });

    // Identificar duplicados
    const duplicados = [];
    grupos.forEach((items, nombreNormalizado) => {
      if (items.length > 1) {
        duplicados.push({
          nombreNormalizado,
          cantidad: items.length,
          items: items.map(r => ({
            _id: r._id,
            codiRespnsble: r.codiRespnsble,
            nmbrRespnsble: r.nmbrRespnsble,
            email: r.email
          }))
        });
      }
    });

    console.log(`\n⚠️  Grupos de duplicados encontrados: ${duplicados.length}`);
    
    if (duplicados.length === 0) {
      console.log('✅ No se encontraron duplicados');
      await mongoose.disconnect();
      return;
    }

    // Mostrar duplicados
    console.log('\n📋 Detalles de duplicados:\n');
    duplicados.forEach((grupo, index) => {
      console.log(`${index + 1}. "${grupo.nombreNormalizado}" (${grupo.cantidad} variaciones):`);
      grupo.items.forEach(item => {
        console.log(`   - Código: ${item.codiRespnsble}, Nombre: "${item.nmbrRespnsble}", Email: ${item.email || 'N/A'}`);
      });
      console.log('');
    });

    // Preguntar si se desea proceder con la normalización
    console.log('\n🔧 OPCIONES DE LIMPIEZA:');
    console.log('1. Solo normalizar nombres (sin eliminar registros)');
    console.log('2. Normalizar y consolidar duplicados (RECOMENDADO)');
    console.log('3. Solo mostrar reporte (sin cambios)');
    console.log('\nEjecuta el script con el argumento correspondiente:');
    console.log('  node limpiar-responsables-duplicados.js normalizar');
    console.log('  node limpiar-responsables-duplicados.js consolidar');
    console.log('  node limpiar-responsables-duplicados.js reporte');

    const modo = process.argv[2];

    if (modo === 'normalizar') {
      console.log('\n🔄 Normalizando nombres...');
      let actualizados = 0;
      
      for (const resp of responsables) {
        const nombreNormalizado = normalizarNombre(resp.nmbrRespnsble);
        if (resp.nmbrRespnsble !== nombreNormalizado) {
          await Responsable.findByIdAndUpdate(resp._id, { 
            nmbrRespnsble: nombreNormalizado 
          });
          console.log(`✅ "${resp.nmbrRespnsble}" → "${nombreNormalizado}"`);
          actualizados++;
        }
      }
      
      console.log(`\n✅ Se normalizaron ${actualizados} nombres`);
    } else if (modo === 'consolidar') {
      console.log('\n🔄 Consolidando duplicados...');
      let eliminados = 0;
      
      for (const grupo of duplicados) {
        const items = grupo.items;
        // Mantener el primero con email, o el primero si ninguno tiene email
        const itemPrincipal = items.find(i => i.email) || items[0];
        const itemsAEliminar = items.filter(i => i._id.toString() !== itemPrincipal._id.toString());
        
        console.log(`\n📌 Consolidando "${grupo.nombreNormalizado}":`);
        console.log(`   Manteniendo: Código ${itemPrincipal.codiRespnsble} (${itemPrincipal.email || 'sin email'})`);
        
        // Actualizar nombre del principal
        await Responsable.findByIdAndUpdate(itemPrincipal._id, { 
          nmbrRespnsble: grupo.nombreNormalizado 
        });
        
        // TODO: Aquí deberías actualizar las referencias en otras colecciones
        // antes de eliminar los duplicados
        console.log('   ⚠️  NOTA: Antes de eliminar, actualiza las referencias en casos de riesgo');
        
        for (const item of itemsAEliminar) {
          console.log(`   Eliminando: Código ${item.codiRespnsble}`);
          // await Responsable.findByIdAndDelete(item._id);
          // eliminados++;
        }
      }
      
      console.log(`\n⚠️  Consolidación preparada pero NO ejecutada`);
      console.log('⚠️  Debes actualizar las referencias en los casos de riesgo primero');
      console.log('⚠️  Descomenta las líneas de eliminación cuando estés listo');
    }

    await mongoose.disconnect();
    console.log('\n✅ Desconectado de MongoDB');
    
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

limpiarDuplicados();
