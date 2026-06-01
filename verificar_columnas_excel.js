import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ARCHIVO_EXCEL = 'sc_xls_20251106132408_236_grid_gsk3c_appsiniestro.xls';

try {
  const rutaArchivo = path.join(__dirname, ARCHIVO_EXCEL);
  
  if (!fs.existsSync(rutaArchivo)) {
    console.error('❌ No se encontró el archivo:', rutaArchivo);
    process.exit(1);
  }

  console.log('📖 Leyendo archivo:', rutaArchivo);
  const workbook = XLSX.readFile(rutaArchivo);
  
  console.log('\n📄 Hojas disponibles:', workbook.SheetNames);
  
  workbook.SheetNames.forEach((sheetName, idx) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`HOJA ${idx + 1}: ${sheetName}`);
    console.log('='.repeat(60));
    
    const worksheet = workbook.Sheets[sheetName];
    
    // Obtener el rango completo
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:Z1');
    console.log(`Rango: ${worksheet['!ref']}`);
    console.log(`Filas: ${range.e.r + 1}, Columnas: ${range.e.c + 1}`);
    
    // Leer como JSON para ver todas las columnas
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });
    
    if (data.length > 0) {
      console.log(`\n📊 Total de filas con datos: ${data.length}`);
      console.log(`\n📋 COLUMNAS DETECTADAS (${Object.keys(data[0]).length} columnas):`);
      
      Object.keys(data[0]).forEach((key, i) => {
        console.log(`  ${i + 1}. "${key}"`);
      });
      
      // Mostrar ejemplo de una fila con valores
      console.log(`\n📝 EJEMPLO DE FILA (fila 1):`);
      const ejemplo = data[0];
      Object.keys(ejemplo).forEach(key => {
        const valor = ejemplo[key];
        if (valor && valor !== '' && key !== '__EMPTY') {
          const valorStr = String(valor).substring(0, 80);
          console.log(`  ${key}: ${valorStr}`);
        }
      });
      
      // Verificar si hay columnas con datos en otras filas
      console.log(`\n🔍 VERIFICANDO COLUMNAS CON DATOS EN PRIMERAS 10 FILAS:`);
      const columnasConDatos = new Set();
      data.slice(0, 10).forEach((fila, idx) => {
        Object.keys(fila).forEach(key => {
          if (fila[key] && fila[key] !== '' && key !== '__EMPTY') {
            columnasConDatos.add(key);
          }
        });
      });
      
      console.log(`Columnas con datos: ${columnasConDatos.size}`);
      Array.from(columnasConDatos).sort().forEach((key, i) => {
        console.log(`  ${i + 1}. "${key}"`);
      });
    }
  });
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}



