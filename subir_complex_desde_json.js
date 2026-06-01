import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Complex from './models/Complex.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// CONFIGURACIÓN
// ============================================

// Ruta del archivo JSON
const ARCHIVO_JSON = process.argv[2] || 'C:\\Users\\GP-TI\\Downloads\\gsk3c_appsiniestro.json';

// Rango de fechas a conservar (octubre 2025 - 14 enero 2026)
const FECHA_INICIO_CONSERVAR = new Date(2025, 9, 1); // Octubre 1, 2025 (mes 9 = octubre, 0-indexed)
const FECHA_FIN_CONSERVAR = new Date(2026, 0, 14); // Enero 14, 2026 (mes 0 = enero)

// ============================================
// FUNCIONES AUXILIARES
// ============================================

/**
 * Convierte una fecha string (yyyy-MM-dd) a Date
 */
function parsearFecha(fechaString) {
  if (!fechaString || fechaString === '' || fechaString === null || fechaString === undefined) {
    return null;
  }
  
  if (fechaString instanceof Date) {
    return fechaString;
  }
  
  const fechaStr = String(fechaString).trim();
  
  // Formato: "YYYY-MM-DD"
  const match = fechaStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const año = parseInt(match[1]);
    const mes = parseInt(match[2]) - 1; // Los meses en JS son 0-indexed
    const dia = parseInt(match[3]);
    if (!isNaN(año) && !isNaN(mes) && !isNaN(dia)) {
      return new Date(año, mes, dia, 12, 0, 0); // Mediodía para evitar problemas de zona horaria
    }
  }
  
  // Intentar parseo estándar
  const fecha = new Date(fechaString);
  return isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Verifica si un registro tiene alguna fecha en el rango a conservar
 */
function tieneFechaEnRangoConservar(registro) {
  const camposFecha = [
    'fcha_asgncion', 'fcha_sinstro', 'fcha_inspccion', 'fcha_cont_ini',
    'fcha_soli_docu', 'fcha_info_prelm', 'fcha_info_fnal', 'fcha_repo_acti',
    'fcha_ult_segui', 'fcha_act_segui', 'fcha_finqto_indem', 'fcha_factra', 'fcha_ult_revi'
  ];
  
  for (const campo of camposFecha) {
    const fechaStr = registro[campo];
    if (fechaStr && fechaStr !== null && fechaStr !== '') {
      const fecha = parsearFecha(fechaStr);
      if (fecha && fecha >= FECHA_INICIO_CONSERVAR && fecha <= FECHA_FIN_CONSERVAR) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Mapea los campos del JSON (snake_case) al modelo Complex (camelCase)
 */
function mapearCampos(registroJSON) {
  const mapeo = {
    'nmro_ajste': 'nmroAjste',
    'cod_workflow': 'codWorkflow',
    'nmro_sinstro': 'nmroSinstro',
    'nomb_intermediario': 'nombIntermediario',
    'codi_asgrdra': 'codiAsgrdra',
    'func_asgrdra': 'funcAsgrdra',
    'codi_respnsble': 'codiRespnsble',
    'asgr_benfcro': 'asgrBenfcro',
    'tipo_ducumento': 'tipoDucumento',
    'num_documento': 'numDocumento',
    'tipo_poliza': 'tipoPoliza',
    'nmro_polza': 'nmroPolza',
    'ampr_afctdo': 'amprAfctdo',
    'fcha_sinstro': 'fchaSinstro',
    'desc_sinstro': 'descSinstro',
    'causa_siniestro': 'causa_siniestro',
    'ciudad_siniestro': 'ciudadSiniestro',
    'fcha_inspccion': 'fchaInspccion',
    'codi_estdo': 'codiEstdo',
    'fcha_cont_ini': 'fchaContIni',
    'obse_cont_ini': 'obseContIni',
    'anex_cont_ini': 'anexContIni',
    'obse_inspccion': 'obseInspccion',
    'fcha_soli_docu': 'fchaSoliDocu',
    'anex_acta_inspccion': 'anexActaInspccion',
    'anex_sol_doc': 'anexSolDoc',
    'obse_soli_docu': 'obseSoliDocu',
    'fcha_info_prelm': 'fchaInfoPrelm',
    'obse_info_prelm': 'obseInfoPrelm',
    'anxo_inf_prelim': 'anxoInfPrelim',
    'fcha_info_fnal': 'fchaInfoFnal',
    'obse_info_fnal': 'obseInfoFnal',
    'anxo_info_fnal': 'anxoInfoFnal',
    'fcha_repo_acti': 'fchaRepoActi',
    'obse_repo_acti': 'obseRepoActi',
    'anxo_repo_acti': 'anxoRepoActi',
    'fcha_ult_segui': 'fchaUltSegui',
    'fcha_act_segui': 'fchaActSegui',
    'dias_transcrrdo': 'diasTranscrrdo',
    'obse_segmnto': 'obseSegmnto',
    'vlor_resrva': 'vlorResrva',
    'vlor_reclmo': 'vlorReclmo',
    'monto_indmzar': 'montoIndmzar',
    'fcha_finqto_indem': 'fchaFinqtoIndem',
    'nmro_factra': 'nmroFactra',
    'vlor_servcios': 'vlorServcios',
    'vlor_gastos': 'vlorGastos',
    'total': 'total',
    'total_general': 'totalGeneral',
    'total_pagado': 'totalPagado',
    'fcha_factra': 'fchaFactra',
    'anxo_factra': 'anxoFactra',
    'anxo_honorarios': 'anxoHonorarios',
    'anxo_honorariosdefinit': 'anxoHonorariosdefinit',
    'anxo_autorizacion': 'anxoAutorizacion',
    'fcha_ult_revi': 'fchaUltRevi',
    'obse_comprmsi': 'obseComprmsi',
    'iva': 'iva',
    'reteiva': 'reteiva',
    'retefuente': 'retefuente',
    'reteica': 'reteica',
    'porc_iva': 'porcIva',
    'porc_reteiva': 'porcReteiva',
    'porc_retefuente': 'porcRetefuente',
    'porc_reteica': 'porcReteica',
    'fcha_asgncion': 'fchaAsgncion'
  };
  
  const camposFecha = [
    'fchaAsgncion', 'fchaSinstro', 'fchaInspccion', 'fchaContIni',
    'fchaSoliDocu', 'fchaInfoPrelm', 'fchaInfoFnal', 'fchaRepoActi',
    'fchaUltSegui', 'fchaActSegui', 'fchaFinqtoIndem', 'fchaFactra', 'fchaUltRevi'
  ];
  
  const camposNumericos = [
    'diasTranscrrdo', 'vlorResrva', 'vlorReclmo', 'montoIndmzar',
    'vlorServcios', 'vlorGastos', 'total', 'totalGeneral', 'totalPagado',
    'iva', 'reteiva', 'retefuente', 'reteica',
    'porcIva', 'porcReteiva', 'porcRetefuente', 'porcReteica'
  ];
  
  const datosMapeados = {};
  
  // Mapear campos
  for (const [campoJSON, campoBD] of Object.entries(mapeo)) {
    const valor = registroJSON[campoJSON];
    
    // Manejar valores undefined (no procesar)
    if (valor === undefined) {
      continue;
    }
    
    if (camposFecha.includes(campoBD)) {
      // Convertir fechas (incluyendo null explícito)
      if (valor === null || valor === '') {
        datosMapeados[campoBD] = null;
      } else {
        const fecha = parsearFecha(valor);
        if (fecha) {
          datosMapeados[campoBD] = fecha;
        } else {
          datosMapeados[campoBD] = null;
        }
      }
    } else if (camposNumericos.includes(campoBD)) {
      // Convertir números (incluyendo 0 y null)
      if (valor === null || valor === '') {
        datosMapeados[campoBD] = null;
      } else {
        const num = typeof valor === 'number' ? valor : parseFloat(valor);
        if (!isNaN(num)) {
          datosMapeados[campoBD] = num;
        } else {
          datosMapeados[campoBD] = null;
        }
      }
    } else {
      // Strings (incluyendo strings vacíos y null)
      if (valor === null) {
        datosMapeados[campoBD] = null;
      } else {
        const str = String(valor).trim();
        // Permitir strings vacíos también (algunos campos pueden ser vacíos válidamente)
        datosMapeados[campoBD] = str === '' ? null : str;
      }
    }
  }
  
  // Asegurar que nmroAjste sea String
  if (datosMapeados.nmroAjste) {
    datosMapeados.nmroAjste = String(datosMapeados.nmroAjste);
  }
  
  return datosMapeados;
}

/**
 * Lee el archivo JSON y extrae los datos
 */
function leerJSON(archivo) {
  try {
    let rutaArchivo = archivo;
    
    if (!path.isAbsolute(archivo)) {
      rutaArchivo = path.join(__dirname, archivo);
    }
    
    if (!fs.existsSync(rutaArchivo)) {
      throw new Error(`❌ No se encontró el archivo: ${archivo}`);
    }
    
    console.log(`📖 Leyendo archivo: ${rutaArchivo}`);
    
    const contenido = fs.readFileSync(rutaArchivo, 'utf8');
    const jsonData = JSON.parse(contenido);
    
    // Buscar el array de datos en la estructura de PHPMyAdmin
    let datos = null;
    
    if (Array.isArray(jsonData)) {
      // Buscar el objeto con type: "table"
      const tabla = jsonData.find(item => item.type === 'table' && item.data);
      if (tabla && Array.isArray(tabla.data)) {
        datos = tabla.data;
      } else {
        // Si no encuentra, asumir que el array completo son los datos
        datos = jsonData;
      }
    } else if (jsonData.data && Array.isArray(jsonData.data)) {
      datos = jsonData.data;
    } else if (Array.isArray(jsonData)) {
      datos = jsonData;
    }
    
    if (!datos || !Array.isArray(datos)) {
      throw new Error('❌ No se pudo encontrar el array de datos en el JSON');
    }
    
    console.log(`✅ Se leyeron ${datos.length} registros del JSON\n`);
    
    return datos;
  } catch (error) {
    console.error('❌ Error leyendo el JSON:', error.message);
    throw error;
  }
}

/**
 * Procesa e inserta los casos en la base de datos
 */
async function procesarCasos(registrosJSON) {
  console.log('\n🔄 Procesando registros...\n');
  
  let insertados = 0;
  let actualizados = 0;
  let conservados = 0; // Casos que se conservaron sin modificar
  let omitidos = 0;
  const errores = [];
  
  // Filtrar registros que tienen fecha en el rango a conservar
  const registrosAConservar = new Set();
  
  for (const registro of registrosJSON) {
    if (tieneFechaEnRangoConservar(registro)) {
      const nmroAjste = String(registro.nmro_ajste || registro.nmroAjste);
      if (nmroAjste) {
        registrosAConservar.add(nmroAjste);
      }
    }
  }
  
  console.log(`📅 Se encontraron ${registrosAConservar.size} casos con fechas entre octubre 2025 y 14 enero 2026 que se conservarán\n`);
  
  for (let i = 0; i < registrosJSON.length; i++) {
    const registro = registrosJSON[i];
    const nmroAjste = String(registro.nmro_ajste || registro.nmroAjste || '');
    
    if (!nmroAjste || nmroAjste === '') {
      console.warn(`⚠️ Registro ${i + 1}: Sin nmro_ajste, omitiendo...`);
      omitidos++;
      continue;
    }
    
    try {
      // Verificar si el caso ya existe
      const casoExistente = await Complex.findOne({ nmroAjste });
      
      // Si está en el rango a conservar y ya existe, conservarlo sin modificar
      if (registrosAConservar.has(nmroAjste) && casoExistente) {
        conservados++;
        if ((i + 1) % 100 === 0) {
          console.log(`✅ Procesados ${i + 1} registros... (${conservados} conservados)`);
        }
        continue;
      }
      
      // Mapear campos
      const datosMapeados = mapearCampos(registro);
      
      if (casoExistente) {
        // Actualizar caso existente - actualizar TODOS los campos del JSON
        Object.keys(datosMapeados).forEach(key => {
          // Actualizar todos los campos que vienen del JSON (incluyendo null para limpiar campos)
          casoExistente[key] = datosMapeados[key];
        });
        await casoExistente.save();
        actualizados++;
      } else {
        // Insertar nuevo caso
        const nuevoCaso = new Complex(datosMapeados);
        await nuevoCaso.save();
        insertados++;
      }
      
      if ((i + 1) % 100 === 0) {
        console.log(`✅ Procesados ${i + 1} registros... (${insertados} insertados, ${actualizados} actualizados, ${conservados} conservados)`);
      }
    } catch (error) {
      console.error(`❌ Registro ${i + 1} (${nmroAjste}): Error:`, error.message);
      errores.push({
        nmroAjste,
        error: error.message
      });
      omitidos++;
    }
  }
  
  return { insertados, actualizados, conservados, omitidos, errores };
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
    
    // Leer JSON
    const registrosJSON = leerJSON(ARCHIVO_JSON);
    
    if (registrosJSON.length === 0) {
      console.log('⚠️ El archivo JSON está vacío');
      await mongoose.disconnect();
      process.exit(0);
    }
    
    // Procesar casos
    const resultado = await procesarCasos(registrosJSON);
    
    // Mostrar resumen
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMEN DEL PROCESO');
    console.log('='.repeat(60));
    console.log(`📥 Total registros en JSON: ${registrosJSON.length}`);
    console.log(`🆕 Casos nuevos insertados: ${resultado.insertados}`);
    console.log(`📝 Casos existentes actualizados: ${resultado.actualizados}`);
    console.log(`🔒 Casos conservados (oct 2025 - 14 ene 2026): ${resultado.conservados}`);
    console.log(`❌ Errores/Omitidos: ${resultado.omitidos}`);
    console.log(`📊 Total procesado: ${resultado.insertados + resultado.actualizados + resultado.conservados}`);
    console.log('='.repeat(60));
    
    if (resultado.errores.length > 0) {
      console.log('\n⚠️ Detalle de errores:');
      resultado.errores.slice(0, 20).forEach(err => {
        console.log(`   - ${err.nmroAjste}: ${err.error}`);
      });
      if (resultado.errores.length > 20) {
        console.log(`   ... y ${resultado.errores.length - 20} más`);
      }
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

