# Script para Subir Casos Complex desde Excel

Este script lee un archivo Excel y sube los casos a la base de datos Complex, eliminando duplicados tanto en el Excel como en la base de datos.

## 🎯 Características

- ✅ Lee archivos Excel (.xls, .xlsx)
- ✅ Elimina duplicados en el Excel (mantiene solo el primero)
- ✅ Elimina duplicados existentes en la base de datos (mantiene el más reciente)
- ✅ Inserta casos nuevos
- ✅ Actualiza casos existentes
- ✅ Mapea automáticamente las columnas del Excel a los campos de la BD
- ✅ Convierte fechas y números correctamente

## 📋 Requisitos

1. Node.js instalado
2. Archivo Excel en la carpeta `backend/`
3. Variables de entorno configuradas (MONGO_URI)

## 🚀 Uso

### 1. Colocar el archivo Excel

Coloca tu archivo Excel en la carpeta `backend/` con el nombre:
```
sc_xls_20251106132408_236_grid_gsk3c_appsiniestro.xls
```

O modifica el nombre en el script:
```javascript
const ARCHIVO_EXCEL = 'tu_archivo.xls';
```

### 2. Ejecutar el script

```bash
cd backend
node subir_casos_complex_excel.js
```

## 📊 Proceso del Script

El script realiza los siguientes pasos:

1. **Lee el Excel**: Extrae todos los datos del archivo
2. **Mapea los datos**: Convierte las columnas del Excel a campos de la BD
3. **Elimina duplicados en Excel**: Si hay casos con el mismo `No. Ajuste`, mantiene solo el primero
4. **Elimina duplicados en BD**: Si hay casos duplicados en la base de datos, elimina los más antiguos y mantiene el más reciente
5. **Inserta/Actualiza**: 
   - Si el caso no existe → lo inserta
   - Si el caso existe → lo actualiza con los datos del Excel

## 🔍 Campo Identificador

El script usa **`No. Ajuste`** (campo `nmroAjste` en la BD) como identificador único para:
- Detectar duplicados
- Identificar casos existentes
- Actualizar casos

## 📝 Mapeo de Columnas

El script mapea automáticamente estas columnas del Excel a campos de la BD:

| Columna Excel | Campo BD |
|--------------|----------|
| No. Ajuste | nmroAjste |
| No. de Siniestro | nmroSinstro |
| Intermediario | nombIntermediario |
| Cod Workflow | codWorkflow |
| No. de Poliza | nmroPolza |
| Responsable | codiRespnsble |
| Aseguradora | codiAsgrdra |
| Asegurado o Beneficiario | asgrBenfcro |
| Fecha Asignacion | fchaAsgncion |
| Fecha de Inspeccion | fchaInspccion |
| Fecha Ultimo Documento | fchaUltRevi |
| Fecha del Inforrme Final | fchaInfoFnal |
| Estado del Siniestro | codiEstdo |
| Funcionario Aseguradora | funcAsgrdra |
| Dias Ultima Revisión | diasTranscrrdo |
| Observaciones de Seguimiento | obseSegmnto |

## ⚠️ Importante

1. **Haz un backup** de tu base de datos antes de ejecutar el script
2. El script **elimina duplicados** en la BD automáticamente
3. Los casos existentes se **actualizan** con los datos del Excel
4. El campo `No. Ajuste` debe ser único y no puede estar vacío

## 📊 Ejemplo de Salida

```
📖 Leyendo archivo: ...
✅ Se leyeron 813 filas del Excel

🔄 Mapeando datos del Excel...
✅ 813 filas mapeadas correctamente

🔍 Eliminando duplicados en el Excel...
⚠️ Se encontraron 5 casos duplicados en el Excel
✅ Se mantendrán 808 casos únicos del Excel

🔍 Buscando duplicados en la base de datos...
🗑️ Se eliminaron duplicados en la base de datos:
   - nmroAjste 20233213: 2 duplicado(s) eliminado(s)

💾 Insertando casos en la base de datos...
✅ Fila 1: Insertado - nmroAjste: 20233213
✅ Fila 2: Actualizado - nmroAjste: 20233214
...

📊 RESUMEN DEL PROCESO
============================================================
📥 Total filas en Excel: 813
✅ Filas mapeadas correctamente: 813
🔄 Duplicados en Excel (eliminados): 5
🗑️ Duplicados en BD (eliminados): 2
🆕 Casos nuevos insertados: 650
📝 Casos existentes actualizados: 158
❌ Errores/Omitidos: 0
📊 Total procesado: 808
============================================================
```

## 🔧 Personalización

Si necesitas cambiar el mapeo de campos, edita el objeto `MAPEO_CAMPOS` en el script:

```javascript
const MAPEO_CAMPOS = {
  'Columna Excel': 'campoBD',
  // ...
};
```

## ❓ Solución de Problemas

### Error: "No se encontró el archivo"
- Verifica que el archivo esté en la carpeta `backend/`
- Verifica el nombre del archivo en `ARCHIVO_EXCEL`

### Error: "No se encontró el campo identificador"
- Verifica que el Excel tenga la columna "No. Ajuste"
- Verifica que todas las filas tengan un valor en "No. Ajuste"

### Error de duplicados en MongoDB
- El script elimina duplicados automáticamente
- Si persiste, verifica que el índice único en `nmroAjste` esté correcto

### Fechas no se parsean correctamente
- El script intenta varios formatos de fecha
- Si hay problemas, verifica el formato en el Excel

