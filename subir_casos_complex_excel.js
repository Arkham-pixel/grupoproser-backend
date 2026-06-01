import 'dotenv/config';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Complex from './models/Complex.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// CONFIGURACIÓN
// ============================================

const ARCHIVO_EXCEL = 'sc_xls_20251106132408_236_grid_gsk3c_appsiniestro.xls';
const CAMPO_UNICO = 'nmroAjste'; // Campo que identifica un caso único

// ⚠️ OPCIÓN DESTRUCTIVA: Si es true, elimina TODOS los casos existentes antes de insertar
// Si es false, solo actualiza/inserta casos del Excel (comportamiento normal)
const ELIMINAR_TODOS_ANTES = true; // ⚠️ CAMBIAR A false PARA MODO SEGURO

// Mapeo de columnas del Excel a campos del modelo Complex
const MAPEO_CAMPOS = {
  'No. Ajuste': 'nmroAjste',
  'No. de Siniestro': 'nmroSinstro',
  'Intermediario': 'nombIntermediario',
  'Cod Workflow': 'codWorkflow',
  'No. de Poliza': 'nmroPolza',
  'Responsable': 'codiRespnsble',
  'Aseguradora': 'codiAsgrdra',
  'Asegurado o Beneficiario': 'asgrBenfcro',
  'Fecha Asignacion': 'fchaAsgncion',
  'Fecha de Inspeccion': 'fchaInspccion',
  'Fecha Ultimo Documento': 'fchaUltRevi',
  'Fecha del Inforrme Final': 'fchaInfoFnal',
  'Estado del Siniestro': 'codiEstdo',
  'Funcionario Aseguradora': 'funcAsgrdra',
  'Dias Ultima Revisión': 'diasTranscrrdo',
  'Observaciones de Seguimiento': 'obseSegmnto',
};

// ============================================
// FUNCIONES AUXILIARES
// ============================================

/**
 * Convierte una fecha en formato texto del Excel a Date
 */
function parsearFecha(fechaTexto) {
  if (!fechaTexto || fechaTexto === '' || fechaTexto === 'N/A' || fechaTexto === 'NaN/NaN/NaN') {
    return null;
  }
  
  // Si es un número (fecha serial de Excel)
  if (typeof fechaTexto === 'number') {
    // Excel cuenta desde 1900-01-01
    try {
      const fecha = XLSX.SSF.parse_date_code(fechaTexto);
      if (fecha) {
        return new Date(fecha.y, fecha.m - 1, fecha.d);
      }
    } catch (e) {
      // Si falla, intentar como timestamp
      const fecha = new Date((fechaTexto - 25569) * 86400 * 1000);
      if (!isNaN(fecha.getTime())) {
        return fecha;
      }
    }
  }
  
  // Intentar parsear como texto
  if (typeof fechaTexto === 'string') {
    const textoLimpio = fechaTexto.trim();
    
    // Verificar si contiene NaN
    if (textoLimpio.includes('NaN') || textoLimpio === 'Invalid Date') {
      return null;
    }
    
    // Formato: "Lunes, 27 Octubre, 2025" o "Lunes, 27  Octubre,  2025" (con espacios extra)
    let match = textoLimpio.match(/(\d{1,2})\s+(\w+)\s*,\s*(\d{4})/);
    if (match) {
      const meses = {
        'enero': 0, 'febrero': 1, 'marzo': 2, 'abril': 3, 'mayo': 4, 'junio': 5,
        'julio': 6, 'agosto': 7, 'septiembre': 8, 'octubre': 9, 'noviembre': 10, 'diciembre': 11,
        'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
        'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
      };
      const dia = parseInt(match[1]);
      const mesNombre = match[2].toLowerCase();
      const mes = meses[mesNombre];
      const año = parseInt(match[3]);
      if (mes !== undefined && !isNaN(dia) && !isNaN(año)) {
        return new Date(año, mes, dia);
      }
    }
    
    // Formato: "DD/MM/YYYY" o "D/M/YYYY"
    match = textoLimpio.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) {
      const dia = parseInt(match[1]);
      const mes = parseInt(match[2]) - 1; // Los meses en JS son 0-indexed
      const año = parseInt(match[3]);
      if (!isNaN(dia) && !isNaN(mes) && !isNaN(año)) {
        return new Date(año, mes, dia);
      }
    }
    
    // Formato: "YYYY-MM-DD" (ISO)
    match = textoLimpio.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
      const año = parseInt(match[1]);
      const mes = parseInt(match[2]) - 1;
      const dia = parseInt(match[3]);
      if (!isNaN(dia) && !isNaN(mes) && !isNaN(año)) {
        return new Date(año, mes, dia);
      }
    }
    
    // Intentar parseo estándar de JavaScript
    try {
      const fecha = new Date(textoLimpio);
      if (!isNaN(fecha.getTime()) && fecha.toString() !== 'Invalid Date') {
        // Verificar que la fecha sea razonable (entre 1900 y 2100)
        const año = fecha.getFullYear();
        if (año >= 1900 && año <= 2100) {
          return fecha;
        }
      }
    } catch (e) {
      // Ignorar errores de parseo
    }
  }
  
  return null;
}

/**
 * Convierte un número o string a número
 */
function parsearNumero(valor) {
  if (valor === null || valor === undefined || valor === '' || valor === 'N/A') {
    return null;
  }
  const num = typeof valor === 'number' ? valor : parseFloat(valor);
  return isNaN(num) ? null : num;
}

/**
 * Limpia un string (elimina espacios, convierte vacíos a null)
 */
function limpiarString(valor) {
  if (valor === null || valor === undefined) {
    return null;
  }
  const str = String(valor).trim();
  return str === '' || str === 'N/A' ? null : str;
}

/**
 * Lee el archivo Excel y retorna los datos
 */
function leerExcel(archivo) {
  try {
    let rutaArchivo = path.join(__dirname, archivo);
    
    if (!fs.existsSync(rutaArchivo)) {
      rutaArchivo = path.join(__dirname, '..', archivo);
    }
    
    if (!fs.existsSync(rutaArchivo)) {
      throw new Error(`❌ No se encontró el archivo: ${archivo}`);
    }

    console.log(`📖 Leyendo archivo: ${rutaArchivo}`);
    
    const workbook = XLSX.readFile(rutaArchivo);
    const sheetName = workbook.SheetNames[0];
    console.log(`📄 Usando hoja: ${sheetName}`);
    
    if (!workbook.Sheets[sheetName]) {
      throw new Error(`❌ No se encontró la hoja: ${sheetName}`);
    }
    
    // Leer el Excel con opciones que preserven mejor las fechas
    const datos = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { 
      defval: '',
      raw: false, // Convertir números de fecha a strings
      dateNF: 'dd/mm/yyyy' // Formato de fecha esperado
    });
    console.log(`✅ Se leyeron ${datos.length} filas del Excel\n`);
    
    return datos;
  } catch (error) {
    console.error('❌ Error leyendo el Excel:', error.message);
    throw error;
  }
}

/**
 * Mapea los datos del Excel al formato del modelo
 */
function mapearDatos(datosExcel) {
  return datosExcel
    .map((fila, index) => {
      const datosMapeados = {};
      
      // Aplicar el mapeo
      for (const [columnaExcel, campoBD] of Object.entries(MAPEO_CAMPOS)) {
        const valor = fila[columnaExcel];
        
        // Para campos de fecha, intentar parsear incluso si parece vacío
        if (campoBD.includes('fcha') || campoBD.includes('Fecha')) {
          // Intentar parsear el valor si existe
          if (valor !== undefined && valor !== null && valor !== '') {
            const fechaParseada = parsearFecha(valor);
            // Solo asignar si la fecha es válida (no null)
            if (fechaParseada !== null) {
              datosMapeados[campoBD] = fechaParseada;
              // Log para debugging (solo primeras 5 filas)
              if (index < 5) {
                console.log(`  ✅ Fecha parseada: ${columnaExcel} (${valor}) → ${campoBD} (${fechaParseada.toISOString().split('T')[0]})`);
              }
            } else if (valor && valor.toString().trim() !== '' && valor.toString().trim() !== 'N/A') {
              // Log si la fecha no se pudo parsear pero había un valor
              if (index < 5) {
                console.warn(`  ⚠️ Fecha NO parseada: ${columnaExcel} (${valor}) → ${campoBD} (valor inválido o formato no reconocido)`);
              }
            }
          }
          // Si es null/vacío, no asignar nada (dejar que MongoDB use el valor por defecto o null)
        } else if (valor !== undefined && valor !== null && valor !== '') {
          // Procesar otros tipos de campos
          if (campoBD.includes('vlor') || campoBD.includes('total') || campoBD.includes('monto') || 
                     campoBD.includes('dias') || campoBD.includes('porc') || campoBD.includes('iva') || 
                     campoBD.includes('rete')) {
            datosMapeados[campoBD] = parsearNumero(valor);
          } else {
            datosMapeados[campoBD] = limpiarString(valor);
          }
        }
      }
      
      // Asegurar que nmroAjste sea String (el modelo lo requiere así)
      if (datosMapeados.nmroAjste) {
        datosMapeados.nmroAjste = String(datosMapeados.nmroAjste);
      }
      
      // Obtener el identificador único
      const identificador = datosMapeados[CAMPO_UNICO];
      
      if (!identificador) {
        console.warn(`⚠️ Fila ${index + 2}: No se encontró el campo identificador "${CAMPO_UNICO}"`);
        return null;
      }
      
      return {
        identificador: String(identificador),
        datos: datosMapeados
      };
    })
    .filter(item => item !== null); // Eliminar filas sin identificador
}

/**
 * Elimina duplicados en el Excel (mantiene solo el primero)
 */
function eliminarDuplicadosExcel(datosMapeados) {
  const visto = new Set();
  const unicos = [];
  const duplicados = [];
  
  for (const item of datosMapeados) {
    if (visto.has(item.identificador)) {
      duplicados.push(item.identificador);
    } else {
      visto.add(item.identificador);
      unicos.push(item);
    }
  }
  
  return { unicos, duplicados };
}

/**
 * Elimina duplicados existentes en la base de datos
 */
async function eliminarDuplicadosBD(identificadores) {
  console.log('\n🔍 Buscando duplicados en la base de datos...');
  
  const duplicadosEncontrados = [];
  const casosExistentesMap = new Map(); // Usar Map para mejor rendimiento
  
  // Buscar todos los casos de una vez
  const todosLosCasos = await Complex.find({ [CAMPO_UNICO]: { $in: identificadores } });
  
  // Agrupar por identificador
  const casosPorIdentificador = new Map();
  todosLosCasos.forEach(caso => {
    const id = String(caso[CAMPO_UNICO]);
    if (!casosPorIdentificador.has(id)) {
      casosPorIdentificador.set(id, []);
    }
    casosPorIdentificador.get(id).push(caso);
  });
  
  // Procesar duplicados
  for (const [identificador, casos] of casosPorIdentificador.entries()) {
    if (casos.length > 1) {
      // Hay duplicados, mantener solo el más reciente
      casos.sort((a, b) => {
        const fechaA = a.updatedAt || a.createdAt || new Date(0);
        const fechaB = b.updatedAt || b.createdAt || new Date(0);
        return fechaB - fechaA;
      });
      
      // Eliminar todos excepto el primero (más reciente)
      const idsAEliminar = casos.slice(1).map(c => c._id);
      await Complex.deleteMany({ _id: { $in: idsAEliminar } });
      
      duplicadosEncontrados.push({
        identificador,
        eliminados: casos.length - 1,
        mantenido: casos[0]._id
      });
      
      casosExistentesMap.set(identificador, casos[0]._id.toString());
    } else if (casos.length === 1) {
      casosExistentesMap.set(identificador, casos[0]._id.toString());
    }
  }
  
  return { duplicadosEncontrados, casosExistentesMap };
}

/**
 * Inserta casos nuevos sin verificar existencia (modo destructivo)
 */
async function insertarCasosNuevos(casosUnicos) {
  console.log('\n💾 Insertando casos en la base de datos (modo reemplazo completo)...\n');
  
  let insertados = 0;
  let omitidos = 0;
  const errores = [];
  
  for (let i = 0; i < casosUnicos.length; i++) {
    const { identificador, datos } = casosUnicos[i];
    
    try {
      // Insertar nuevo caso directamente
      const nuevoCaso = new Complex(datos);
      await nuevoCaso.save();
      insertados++;
      
      if ((i + 1) % 50 === 0) {
        console.log(`✅ Procesadas ${i + 1} filas...`);
      }
    } catch (error) {
      console.error(`❌ Fila ${i + 1}: Error procesando ${identificador}:`, error.message);
      errores.push({
        identificador,
        error: error.message
      });
      omitidos++;
    }
  }
  
  return { insertados, actualizados: 0, omitidos, errores };
}

/**
 * Inserta los casos únicos en la base de datos (modo normal)
 */
async function insertarCasos(casosUnicos, casosExistentesMap) {
  console.log('\n💾 Insertando casos en la base de datos...\n');
  
  let insertados = 0;
  let actualizados = 0;
  let omitidos = 0;
  const errores = [];
  
  for (let i = 0; i < casosUnicos.length; i++) {
    const { identificador, datos } = casosUnicos[i];
    
    try {
      // Verificar si ya existe usando el mapa
      const existeId = casosExistentesMap.get(identificador);
      
      if (existeId) {
        // Actualizar caso existente
        const casoExistente = await Complex.findById(existeId);
        if (casoExistente) {
          // Actualizar todos los campos que vienen del Excel
          // Para fechas: si viene una fecha válida, actualizar; si viene null/vacío, mantener la existente
          Object.keys(datos).forEach(key => {
            if (key.includes('fcha')) {
              // Para fechas: solo actualizar si hay una fecha válida
              if (datos[key] !== null && datos[key] !== undefined) {
                casoExistente[key] = datos[key];
              }
            } else {
              // Para otros campos: actualizar si tiene valor
              if (datos[key] !== null && datos[key] !== undefined && datos[key] !== '') {
                casoExistente[key] = datos[key];
              }
            }
          });
          await casoExistente.save();
          actualizados++;
          console.log(`✅ Fila ${i + 1}: Actualizado - ${CAMPO_UNICO}: ${identificador}`);
        } else {
          // Si no se encuentra por ID, buscar por identificador
          const casoPorIdentificador = await Complex.findOne({ [CAMPO_UNICO]: identificador });
          if (casoPorIdentificador) {
            // Actualizar todos los campos que vienen del Excel
            Object.keys(datos).forEach(key => {
              if (key.includes('fcha')) {
                // Para fechas: solo actualizar si hay una fecha válida
                if (datos[key] !== null && datos[key] !== undefined) {
                  casoPorIdentificador[key] = datos[key];
                }
              } else {
                // Para otros campos: actualizar si tiene valor
                if (datos[key] !== null && datos[key] !== undefined && datos[key] !== '') {
                  casoPorIdentificador[key] = datos[key];
                }
              }
            });
            await casoPorIdentificador.save();
            actualizados++;
            console.log(`✅ Fila ${i + 1}: Actualizado - ${CAMPO_UNICO}: ${identificador}`);
          } else {
            // No existe, crear nuevo
            const nuevoCaso = new Complex(datos);
            await nuevoCaso.save();
            insertados++;
            console.log(`✅ Fila ${i + 1}: Insertado - ${CAMPO_UNICO}: ${identificador}`);
          }
        }
      } else {
        // No existe, insertar nuevo caso
        const nuevoCaso = new Complex(datos);
        await nuevoCaso.save();
        insertados++;
        console.log(`✅ Fila ${i + 1}: Insertado - ${CAMPO_UNICO}: ${identificador}`);
      }
    } catch (error) {
      console.error(`❌ Fila ${i + 1}: Error procesando ${identificador}:`, error.message);
      errores.push({
        identificador,
        error: error.message
      });
      omitidos++;
    }
  }
  
  return { insertados, actualizados, omitidos, errores };
}

/**
 * Función principal
 */
async function main() {
  try {
    // Conectar a MongoDB
    const MONGO_URI = process.env.MONGO_URI;
    if (!MONGO_URI) {
      console.error('❌ La variable de entorno MONGO_URI no está definida.');
      process.exit(1);
    }

    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Conectado a MongoDB\n');

    // Leer Excel
    const datosExcel = leerExcel(ARCHIVO_EXCEL);
    
    if (datosExcel.length === 0) {
      console.log('⚠️ El archivo Excel está vacío');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Mapear datos
    console.log('🔄 Mapeando datos del Excel...');
    const datosMapeados = mapearDatos(datosExcel);
    console.log(`✅ ${datosMapeados.length} filas mapeadas correctamente`);
    
    // Contar cuántas fechas se parsearon correctamente
    let fechasParseadas = 0;
    let fechasNoParseadas = 0;
    datosMapeados.slice(0, 10).forEach((item, idx) => {
      const fechasEnItem = Object.keys(item.datos).filter(k => k.includes('fcha'));
      fechasEnItem.forEach(fechaKey => {
        if (item.datos[fechaKey]) {
          fechasParseadas++;
        } else {
          fechasNoParseadas++;
        }
      });
    });
    console.log(`📊 Estadísticas de fechas (primeras 10 filas): ${fechasParseadas} parseadas, ${fechasNoParseadas} vacías/inválidas\n`);

    // Eliminar duplicados en el Excel
    console.log('🔍 Eliminando duplicados en el Excel...');
    const { unicos, duplicados } = eliminarDuplicadosExcel(datosMapeados);
    
    if (duplicados.length > 0) {
      console.log(`⚠️ Se encontraron ${duplicados.length} casos duplicados en el Excel:`);
      const duplicadosUnicos = [...new Set(duplicados)];
      duplicadosUnicos.slice(0, 10).forEach(id => console.log(`   - ${id}`));
      if (duplicadosUnicos.length > 10) {
        console.log(`   ... y ${duplicadosUnicos.length - 10} más`);
      }
      console.log(`✅ Se mantendrán ${unicos.length} casos únicos del Excel\n`);
    } else {
      console.log(`✅ No se encontraron duplicados en el Excel\n`);
    }

    // Obtener identificadores únicos
    const identificadores = unicos.map(c => c.identificador);

    // ⚠️ OPCIÓN DESTRUCTIVA: Eliminar todos los casos existentes
    let resultado;
    let duplicadosEncontrados = [];
    let resultadoEliminacion = null;
    
    if (ELIMINAR_TODOS_ANTES) {
      console.log('\n⚠️ ⚠️ ⚠️  MODO DESTRUCTIVO ACTIVADO ⚠️ ⚠️ ⚠️');
      console.log('🗑️ Eliminando TODOS los casos existentes en la base de datos...');
      
      resultadoEliminacion = await Complex.deleteMany({});
      console.log(`✅ Se eliminaron ${resultadoEliminacion.deletedCount} casos existentes`);
      console.log('📝 Ahora se insertarán solo los casos del Excel\n');
      
      // Insertar solo casos nuevos (sin verificar existencia)
      resultado = await insertarCasosNuevos(unicos);
    } else {
      // Modo normal: eliminar duplicados y actualizar/insertar
      const resultadoDuplicados = await eliminarDuplicadosBD(identificadores);
      duplicadosEncontrados = resultadoDuplicados.duplicadosEncontrados;
      const casosExistentesMap = resultadoDuplicados.casosExistentesMap;
      
      if (duplicadosEncontrados.length > 0) {
        console.log(`\n🗑️ Se eliminaron duplicados en la base de datos:`);
        duplicadosEncontrados.forEach(dup => {
          console.log(`   - ${CAMPO_UNICO} ${dup.identificador}: ${dup.eliminados} duplicado(s) eliminado(s)`);
        });
      } else {
        console.log(`✅ No se encontraron duplicados en la base de datos`);
      }

      // Insertar/Actualizar casos
      resultado = await insertarCasos(unicos, casosExistentesMap);
    }

    // Mostrar resumen
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMEN DEL PROCESO');
    console.log('='.repeat(60));
    console.log(`📥 Total filas en Excel: ${datosExcel.length}`);
    console.log(`✅ Filas mapeadas correctamente: ${datosMapeados.length}`);
    console.log(`🔄 Duplicados en Excel (eliminados): ${duplicados.length}`);
    if (ELIMINAR_TODOS_ANTES) {
      console.log(`🗑️ Modo: REEMPLAZO COMPLETO (${resultadoEliminacion?.deletedCount || 0} casos anteriores eliminados)`);
    } else {
      console.log(`🗑️ Duplicados en BD (eliminados): ${duplicadosEncontrados.length}`);
    }
    console.log(`🆕 Casos nuevos insertados: ${resultado.insertados}`);
    if (!ELIMINAR_TODOS_ANTES) {
      console.log(`📝 Casos existentes actualizados: ${resultado.actualizados}`);
    }
    console.log(`❌ Errores/Omitidos: ${resultado.omitidos}`);
    console.log(`📊 Total procesado: ${resultado.insertados + (resultado.actualizados || 0)}`);
    console.log('='.repeat(60));
    
    if (resultado.errores.length > 0) {
      console.log('\n⚠️ Detalle de errores:');
      resultado.errores.forEach(err => {
        console.log(`   - ${CAMPO_UNICO} ${err.identificador}: ${err.error}`);
      });
    }

    // Desconectar
    await mongoose.disconnect();
    console.log('\n✅ Desconectado de MongoDB');
    console.log('✅ Proceso completado exitosamente');

  } catch (error) {
    console.error('\n❌ Error en el proceso:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

// Ejecutar
main();

