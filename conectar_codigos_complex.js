import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from './models/Complex.js';
import Estado from './models/Estado.js';
import Ciudad from './models/Ciudad.js';

/**
 * Script para conectar códigos con sus descripciones en la base de datos Complex
 * Actualiza descripcionEstado y agrega descripcionCiudad basándose en los códigos
 */

async function conectarCodigos() {
  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Conectado a MongoDB\n');

    // 1. Cargar todos los estados en memoria para búsqueda rápida
    console.log('📖 Cargando estados...');
    const estados = await Estado.find({}).lean();
    const estadosMap = new Map();
    estados.forEach(estado => {
      // El código puede ser Number o String, normalizar a String
      const codigo = String(estado.codiEstdo || '');
      if (codigo) {
        estadosMap.set(codigo, estado.descEstdo || '');
      }
    });
    console.log(`✅ ${estados.length} estados cargados\n`);

    // 2. Cargar todas las ciudades en memoria para búsqueda rápida
    console.log('📖 Cargando ciudades...');
    const ciudades = await Ciudad.find({}).lean();
    const ciudadesMapPorCodigoPoblado = new Map(); // Para códigos de 8 dígitos (codiCpoblado)
    const ciudadesMapPorCodigoMunicipio = new Map(); // Para códigos de 5 dígitos (codiMunicipio)
    const ciudadesMapPorNombre = new Map();
    
    ciudades.forEach(ciudad => {
      // Mapear por código de poblado (8 dígitos) - este es el principal
      const codigoPoblado = String(ciudad.codiCpoblado || ciudad.codiPoblado || '').trim();
      if (codigoPoblado) {
        ciudadesMapPorCodigoPoblado.set(codigoPoblado, {
          descMunicipio: ciudad.descMunicipio || ciudad.descCpoblado || '',
          descDepto: ciudad.descDepto || '',
          descPais: ciudad.descPais || ''
        });
      }
      
      // También mapear por código de municipio (5 dígitos) como fallback
      const codigoMunicipio = String(ciudad.codiMunicipio || '').trim();
      if (codigoMunicipio) {
        ciudadesMapPorCodigoMunicipio.set(codigoMunicipio, {
          descMunicipio: ciudad.descMunicipio || '',
          descDepto: ciudad.descDepto || '',
          descPais: ciudad.descPais || ''
        });
      }
      
      // También mapear por nombre (para casos donde viene el nombre en lugar del código)
      const nombreMunicipio = String(ciudad.descMunicipio || ciudad.descCpoblado || '').trim().toUpperCase();
      if (nombreMunicipio) {
        // Si ya existe, mantener el primero (o el más completo)
        if (!ciudadesMapPorNombre.has(nombreMunicipio)) {
          ciudadesMapPorNombre.set(nombreMunicipio, {
            descMunicipio: ciudad.descMunicipio || ciudad.descCpoblado || '',
            descDepto: ciudad.descDepto || '',
            descPais: ciudad.descPais || ''
          });
        }
      }
    });
    console.log(`✅ ${ciudades.length} ciudades cargadas`);
    console.log(`   - ${ciudadesMapPorCodigoPoblado.size} por código de poblado (8 dígitos)`);
    console.log(`   - ${ciudadesMapPorCodigoMunicipio.size} por código de municipio (5 dígitos)`);
    console.log(`   - ${ciudadesMapPorNombre.size} por nombre\n`);

    // 3. Obtener todos los casos Complex
    console.log('📖 Obteniendo casos Complex...');
    const casos = await Complex.find({}).lean();
    console.log(`✅ ${casos.length} casos encontrados\n`);

    // 4. Actualizar cada caso
    console.log('🔄 Actualizando casos con descripciones...\n');
    
    let actualizados = 0;
    let estadosActualizados = 0;
    let ciudadesActualizadas = 0;
    let estadosNoEncontrados = new Set();
    let ciudadesNoEncontradas = new Set();
    
    for (let i = 0; i < casos.length; i++) {
      const caso = casos[i];
      const actualizaciones = {};
      let necesitaActualizacion = false;

      // Actualizar descripción de estado
      if (caso.codiEstdo) {
        const codigoEstado = String(caso.codiEstdo).trim();
        const descripcionEstado = estadosMap.get(codigoEstado);
        
        if (descripcionEstado) {
          if (caso.descripcionEstado !== descripcionEstado) {
            actualizaciones.descripcionEstado = descripcionEstado;
            necesitaActualizacion = true;
            estadosActualizados++;
          }
        } else {
          estadosNoEncontrados.add(codigoEstado);
        }
      }

      // Actualizar descripción de ciudad
      if (caso.ciudadSiniestro) {
        const codigoCiudad = String(caso.ciudadSiniestro).trim();
        let ciudadInfo = null;
        
        // Si es un código numérico de 8 dígitos, buscar por codiCpoblado
        if (/^\d{8}$/.test(codigoCiudad)) {
          ciudadInfo = ciudadesMapPorCodigoPoblado.get(codigoCiudad);
          
          // Si no se encuentra, intentar con los primeros 5 dígitos (código de municipio)
          if (!ciudadInfo) {
            const codigo5Digitos = codigoCiudad.substring(0, 5);
            ciudadInfo = ciudadesMapPorCodigoMunicipio.get(codigo5Digitos);
          }
        } else if (/^\d{5}$/.test(codigoCiudad)) {
          // Si es un código de 5 dígitos, buscar por codiMunicipio
          ciudadInfo = ciudadesMapPorCodigoMunicipio.get(codigoCiudad);
        } else {
          // Si no es numérico, buscar por nombre
          const nombreNormalizado = codigoCiudad.toUpperCase().trim();
          ciudadInfo = ciudadesMapPorNombre.get(nombreNormalizado);
          
          // Si aún no se encuentra, intentar búsqueda parcial (contiene)
          if (!ciudadInfo) {
            const ciudadEncontrada = ciudades.find(c => {
              const descMunicipio = String(c.descMunicipio || c.descCpoblado || '').toUpperCase().trim();
              return descMunicipio === nombreNormalizado || 
                     descMunicipio.includes(nombreNormalizado) ||
                     nombreNormalizado.includes(descMunicipio);
            });
            
            if (ciudadEncontrada) {
              ciudadInfo = {
                descMunicipio: ciudadEncontrada.descMunicipio || ciudadEncontrada.descCpoblado || '',
                descDepto: ciudadEncontrada.descDepto || '',
                descPais: ciudadEncontrada.descPais || ''
              };
            }
          }
        }
        
        if (ciudadInfo) {
          // Construir descripción completa: Municipio, Departamento, País
          let descripcionCompleta = ciudadInfo.descMunicipio || '';
          if (ciudadInfo.descDepto) {
            descripcionCompleta += descripcionCompleta ? `, ${ciudadInfo.descDepto}` : ciudadInfo.descDepto;
          }
          if (ciudadInfo.descPais) {
            descripcionCompleta += descripcionCompleta ? `, ${ciudadInfo.descPais}` : ciudadInfo.descPais;
          }
          
          // Actualizar campos de descripción de ciudad
          if (!caso.descripcionCiudad || caso.descripcionCiudad !== descripcionCompleta) {
            actualizaciones.descripcionCiudad = descripcionCompleta;
            actualizaciones.nombreCiudad = ciudadInfo.descMunicipio || '';
            actualizaciones.departamentoCiudad = ciudadInfo.descDepto || '';
            necesitaActualizacion = true;
            ciudadesActualizadas++;
          }
        } else {
          ciudadesNoEncontradas.add(codigoCiudad);
        }
      }

      // Actualizar el caso si hay cambios
      if (necesitaActualizacion) {
        await Complex.updateOne(
          { _id: caso._id },
          { $set: actualizaciones }
        );
        actualizados++;
      }

      if ((i + 1) % 100 === 0) {
        console.log(`✅ Procesados ${i + 1}/${casos.length} casos...`);
      }
    }

    // 5. Mostrar resumen
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMEN DEL PROCESO');
    console.log('='.repeat(60));
    console.log(`📥 Total casos procesados: ${casos.length}`);
    console.log(`✅ Casos actualizados: ${actualizados}`);
    console.log(`📝 Estados actualizados: ${estadosActualizados}`);
    console.log(`🏙️  Ciudades actualizadas: ${ciudadesActualizadas}`);
    console.log('='.repeat(60));

    if (estadosNoEncontrados.size > 0) {
      console.log(`\n⚠️  Estados no encontrados (${estadosNoEncontrados.size} códigos únicos):`);
      Array.from(estadosNoEncontrados).slice(0, 20).forEach(codigo => {
        console.log(`   - ${codigo}`);
      });
      if (estadosNoEncontrados.size > 20) {
        console.log(`   ... y ${estadosNoEncontrados.size - 20} más`);
      }
    }

    if (ciudadesNoEncontradas.size > 0) {
      console.log(`\n⚠️  Ciudades no encontradas (${ciudadesNoEncontradas.size} códigos únicos):`);
      Array.from(ciudadesNoEncontradas).slice(0, 20).forEach(codigo => {
        console.log(`   - ${codigo}`);
      });
      if (ciudadesNoEncontradas.size > 20) {
        console.log(`   ... y ${ciudadesNoEncontradas.size - 20} más`);
      }
    }

    // 6. Verificar que el schema tenga los campos necesarios
    console.log('\n🔍 Verificando schema del modelo Complex...');
    const schema = Complex.schema;
    const tieneDescripcionCiudad = schema.paths.descripcionCiudad !== undefined;
    const tieneNombreCiudad = schema.paths.nombreCiudad !== undefined;
    
    if (!tieneDescripcionCiudad || !tieneNombreCiudad) {
      console.log('⚠️  El modelo Complex no tiene campos para descripción de ciudad.');
      console.log('   Los campos se agregarán dinámicamente (MongoDB permite esto).');
      console.log('   Para hacerlo permanente, actualiza el schema en models/Complex.js');
    } else {
      console.log('✅ El modelo Complex tiene los campos necesarios');
    }

    await mongoose.disconnect();
    console.log('\n✅ Proceso completado exitosamente');

  } catch (error) {
    console.error('\n❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

conectarCodigos();

