import 'dotenv/config';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// CONFIGURACIÓN - AJUSTA ESTOS VALORES
// ============================================

// 1. Nombre del archivo Excel (debe estar en la carpeta backend o especificar ruta completa)
const ARCHIVO_EXCEL = 'datos_actualizar.xlsx'; // Cambia esto por el nombre de tu archivo Excel

// 2. Nombre de la hoja del Excel a leer (por defecto la primera hoja)
const NOMBRE_HOJA = null; // null = primera hoja, o especifica el nombre: 'Hoja1'

// 3. Modelo de Mongoose a actualizar (importa el modelo necesario)
// Ejemplo: import Cliente from './models/Cliente.js';
// Ejemplo: import Usuario from './models/Usuario.js';
import Cliente from './models/Cliente.js';
// Cambia 'Cliente' por el modelo que necesites actualizar

// 4. Campo único para identificar el documento a actualizar (ej: 'correo', 'cedula', '_id', etc.)
const CAMPO_IDENTIFICADOR = 'correo'; // Campo que se usa para buscar el documento

// 5. Mapeo de columnas del Excel a campos de la base de datos
// Formato: { 'NombreColumnaExcel': 'campoEnBaseDatos' }
const MAPEO_CAMPOS = {
  'Correo': 'correo',
  'Código Aseguradora': 'codiAsgrdra',
  'Razón Social': 'rzonSocial',
  'Teléfono Fijo': 'teleFijo',
  'Teléfono Celular': 'teleCellar',
  'Dirección': 'direCliente',
  'Código País': 'codiPais',
  'Código Departamento': 'codiDepto',
  'Código Municipio': 'codiMpio',
  'Código Poblado': 'codiPoblado',
  'Estado': 'codiEstdo',
  'Descuento IVA': 'descIva',
  'Retención IVA': 'reteIva',
  'Retención Fuente': 'reteFuente',
  'Retención ICA': 'reteIca',
};
// Ajusta este mapeo según las columnas de tu Excel y los campos de tu modelo

// 6. Modelo a usar (cambia según el modelo que importaste arriba)
const Modelo = Cliente;

// 7. Opciones de actualización
const OPCIONES = {
  crearSiNoExiste: false, // true = crea nuevos documentos si no existen, false = solo actualiza existentes
  mostrarResumen: true,   // true = muestra resumen al final
  validarAntesDeActualizar: true, // true = muestra qué se va a actualizar antes de hacerlo
};

// ============================================
// FUNCIONES
// ============================================

/**
 * Lee el archivo Excel y retorna los datos como array de objetos
 */
function leerExcel(archivo, nombreHoja = null) {
  try {
    // Buscar el archivo en diferentes ubicaciones
    let rutaArchivo = path.join(__dirname, archivo);
    
    if (!fs.existsSync(rutaArchivo)) {
      // Intentar en la raíz del proyecto
      rutaArchivo = path.join(__dirname, '..', archivo);
    }
    
    if (!fs.existsSync(rutaArchivo)) {
      throw new Error(`❌ No se encontró el archivo: ${archivo}`);
    }

    console.log(`📖 Leyendo archivo: ${rutaArchivo}`);
    
    const workbook = XLSX.readFile(rutaArchivo);
    
    // Obtener el nombre de la hoja
    const sheetName = nombreHoja || workbook.SheetNames[0];
    console.log(`📄 Usando hoja: ${sheetName}`);
    
    if (!workbook.Sheets[sheetName]) {
      throw new Error(`❌ No se encontró la hoja: ${sheetName}`);
    }
    
    // Convertir a JSON
    const datos = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    console.log(`✅ Se leyeron ${datos.length} filas del Excel\n`);
    
    return datos;
  } catch (error) {
    console.error('❌ Error leyendo el Excel:', error.message);
    throw error;
  }
}

/**
 * Convierte los datos del Excel usando el mapeo de campos
 */
function mapearDatos(datosExcel) {
  return datosExcel.map((fila, index) => {
    const datosMapeados = {};
    
    // Aplicar el mapeo
    for (const [columnaExcel, campoBD] of Object.entries(MAPEO_CAMPOS)) {
      if (fila[columnaExcel] !== undefined && fila[columnaExcel] !== null && fila[columnaExcel] !== '') {
        datosMapeados[campoBD] = fila[columnaExcel];
      }
    }
    
    // Obtener el valor del campo identificador
    const valorIdentificador = fila[Object.keys(MAPEO_CAMPOS).find(key => MAPEO_CAMPOS[key] === CAMPO_IDENTIFICADOR)] 
                              || fila[CAMPO_IDENTIFICADOR]
                              || fila[Object.keys(fila).find(key => key.toLowerCase() === CAMPO_IDENTIFICADOR.toLowerCase())];
    
    if (!valorIdentificador) {
      console.warn(`⚠️ Fila ${index + 2}: No se encontró el campo identificador "${CAMPO_IDENTIFICADOR}"`);
    }
    
    return {
      identificador: valorIdentificador,
      datos: datosMapeados
    };
  });
}

/**
 * Actualiza los documentos en la base de datos
 */
async function actualizarBaseDatos(datosMapeados) {
  let actualizados = 0;
  let creados = 0;
  let errores = 0;
  const erroresDetalle = [];

  console.log('\n🔄 Iniciando actualización...\n');

  for (let i = 0; i < datosMapeados.length; i++) {
    const { identificador, datos } = datosMapeados[i];
    
    if (!identificador) {
      console.log(`⚠️ Fila ${i + 2}: Se omite porque no tiene identificador`);
      errores++;
      erroresDetalle.push({ fila: i + 2, error: 'Sin identificador' });
      continue;
    }

    try {
      // Buscar el documento
      const query = { [CAMPO_IDENTIFICADOR]: identificador };
      const documentoExistente = await Modelo.findOne(query);

      if (documentoExistente) {
        // Actualizar documento existente
        if (OPCIONES.validarAntesDeActualizar) {
          console.log(`📝 Fila ${i + 2}: Actualizando ${CAMPO_IDENTIFICADOR}: ${identificador}`);
        }
        
        Object.assign(documentoExistente, datos);
        await documentoExistente.save();
        actualizados++;
        
        if (!OPCIONES.validarAntesDeActualizar) {
          console.log(`✅ Fila ${i + 2}: Actualizado - ${CAMPO_IDENTIFICADOR}: ${identificador}`);
        }
      } else {
        // Documento no existe
        if (OPCIONES.crearSiNoExiste) {
          const nuevoDocumento = new Modelo({
            [CAMPO_IDENTIFICADOR]: identificador,
            ...datos
          });
          await nuevoDocumento.save();
          creados++;
          console.log(`✅ Fila ${i + 2}: Creado nuevo - ${CAMPO_IDENTIFICADOR}: ${identificador}`);
        } else {
          console.log(`⚠️ Fila ${i + 2}: No encontrado - ${CAMPO_IDENTIFICADOR}: ${identificador} (se omite porque crearSiNoExiste = false)`);
          errores++;
          erroresDetalle.push({ 
            fila: i + 2, 
            identificador, 
            error: 'Documento no encontrado' 
          });
        }
      }
    } catch (error) {
      console.error(`❌ Fila ${i + 2}: Error procesando ${identificador}:`, error.message);
      errores++;
      erroresDetalle.push({ 
        fila: i + 2, 
        identificador, 
        error: error.message 
      });
    }
  }

  return { actualizados, creados, errores, erroresDetalle };
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
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB\n');

    // Leer Excel
    const datosExcel = leerExcel(ARCHIVO_EXCEL, NOMBRE_HOJA);
    
    if (datosExcel.length === 0) {
      console.log('⚠️ El archivo Excel está vacío');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Mapear datos
    console.log('🔄 Mapeando datos del Excel a campos de la base de datos...');
    const datosMapeados = mapearDatos(datosExcel);
    console.log(`✅ ${datosMapeados.length} filas mapeadas\n`);

    // Mostrar vista previa si está habilitada
    if (OPCIONES.validarAntesDeActualizar) {
      console.log('📋 Vista previa de los cambios:');
      console.log('='.repeat(60));
      datosMapeados.slice(0, 5).forEach((item, i) => {
        console.log(`\nFila ${i + 1}:`);
        console.log(`  Identificador (${CAMPO_IDENTIFICADOR}): ${item.identificador}`);
        console.log(`  Campos a actualizar:`, Object.keys(item.datos).join(', '));
      });
      if (datosMapeados.length > 5) {
        console.log(`\n... y ${datosMapeados.length - 5} filas más`);
      }
      console.log('\n' + '='.repeat(60));
      console.log('\n⚠️ IMPORTANTE: Revisa la configuración antes de continuar.');
      console.log('💡 Si todo está correcto, cambia validarAntesDeActualizar a false para ejecutar la actualización.\n');
      
      // Si está en modo validación, no actualiza
      await mongoose.disconnect();
      console.log('✅ Desconectado de MongoDB');
      console.log('\n💡 Para ejecutar la actualización, cambia validarAntesDeActualizar a false en el script.');
      process.exit(0);
    }

    // Actualizar base de datos
    const resultado = await actualizarBaseDatos(datosMapeados);

    // Mostrar resumen
    if (OPCIONES.mostrarResumen) {
      console.log('\n' + '='.repeat(60));
      console.log('📊 RESUMEN DE ACTUALIZACIÓN');
      console.log('='.repeat(60));
      console.log(`✅ Documentos actualizados: ${resultado.actualizados}`);
      if (OPCIONES.crearSiNoExiste) {
        console.log(`🆕 Documentos creados: ${resultado.creados}`);
      }
      console.log(`❌ Errores: ${resultado.errores}`);
      console.log(`📝 Total procesado: ${datosMapeados.length}`);
      
      if (resultado.erroresDetalle.length > 0) {
        console.log('\n⚠️ Detalle de errores:');
        resultado.erroresDetalle.forEach(err => {
          console.log(`  - Fila ${err.fila}: ${err.identificador || 'N/A'} - ${err.error}`);
        });
      }
      console.log('='.repeat(60));
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

