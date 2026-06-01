# Script para Subir Base de Datos Complex desde JSON

Este script lee un archivo JSON (exportación de PHPMyAdmin) y sube los casos a la base de datos Complex, **conservando la información de octubre 2025 a 14 de enero 2026**.

## 🎯 Características

- ✅ Lee archivos JSON (exportación PHPMyAdmin)
- ✅ Conserva casos existentes con fechas entre octubre 2025 y 14 enero 2026
- ✅ Inserta casos nuevos
- ✅ Actualiza casos existentes (excepto los conservados)
- ✅ Mapea automáticamente los campos del JSON (snake_case) a la BD (camelCase)
- ✅ Convierte fechas y números correctamente

## 📋 Requisitos

1. Node.js instalado
2. Archivo JSON (exportación de PHPMyAdmin)
3. Variables de entorno configuradas (MONGO_URI)

## 🚀 Uso

### 1. Ejecutar el script

```bash
cd backend
node subir_complex_desde_json.js [ruta_al_archivo.json]
```

**Ejemplo:**
```bash
node subir_complex_desde_json.js "C:\Users\GP-TI\Downloads\gsk3c_appsiniestro.json"
```

Si no se especifica la ruta, el script usará por defecto:
```
C:\Users\GP-TI\Downloads\gsk3c_appsiniestro.json
```

### 2. El script automáticamente:

1. **Lee el JSON**: Extrae todos los registros del archivo
2. **Identifica casos a conservar**: Busca registros con fechas entre octubre 2025 y 14 enero 2026
3. **Procesa cada registro**:
   - Si el caso **existe** y está en el rango a conservar → **NO lo modifica** (se conserva)
   - Si el caso **existe** pero NO está en el rango → **lo actualiza** con datos del JSON
   - Si el caso **NO existe** → **lo inserta** como nuevo

## 🔒 Conservación de Datos

El script **conserva sin modificar** todos los casos que tienen **cualquier fecha** entre:
- **Inicio**: 1 de octubre de 2025
- **Fin**: 14 de enero de 2026

Las fechas que se verifican son:
- `fcha_asgncion` (Fecha Asignación)
- `fcha_sinstro` (Fecha Siniestro)
- `fcha_inspccion` (Fecha Inspección)
- `fcha_cont_ini` (Fecha Contacto Inicial)
- `fcha_soli_docu` (Fecha Solicitud Documentos)
- `fcha_info_prelm` (Fecha Informe Preliminar)
- `fcha_info_fnal` (Fecha Informe Final)
- `fcha_repo_acti` (Fecha Reporte Actividad)
- `fcha_ult_segui` (Fecha Último Seguimiento)
- `fcha_act_segui` (Fecha Actual Seguimiento)
- `fcha_finqto_indem` (Fecha Finiquito Indemnización)
- `fcha_factra` (Fecha Factura)
- `fcha_ult_revi` (Fecha Última Revisión)

## 📝 Mapeo de Campos

El script mapea automáticamente los campos del JSON (snake_case) a los campos de la BD (camelCase):

| Campo JSON | Campo BD |
|-----------|----------|
| nmro_ajste | nmroAjste |
| cod_workflow | codWorkflow |
| nmro_sinstro | nmroSinstro |
| nomb_intermediario | nombIntermediario |
| codi_asgrdra | codiAsgrdra |
| func_asgrdra | funcAsgrdra |
| codi_respnsble | codiRespnsble |
| asgr_benfcro | asgrBenfcro |
| fcha_asgncion | fchaAsgncion |
| fcha_sinstro | fchaSinstro |
| ... | ... |

## 📊 Ejemplo de Salida

```
📖 Leyendo archivo: C:\Users\GP-TI\Downloads\gsk3c_appsiniestro.json
✅ Se leyeron 702 registros del JSON

🔄 Procesando registros...

📅 Se encontraron 45 casos con fechas entre octubre 2025 y 14 enero 2026 que se conservarán

✅ Procesados 100 registros... (50 insertados, 30 actualizados, 20 conservados)
✅ Procesados 200 registros... (100 insertados, 60 actualizados, 40 conservados)
...

📊 RESUMEN DEL PROCESO
============================================================
📥 Total registros en JSON: 702
🆕 Casos nuevos insertados: 350
📝 Casos existentes actualizados: 307
🔒 Casos conservados (oct 2025 - 14 ene 2026): 45
❌ Errores/Omitidos: 0
📊 Total procesado: 702
============================================================

✅ Desconectado de MongoDB
✅ Proceso completado exitosamente
```

## ⚠️ Importante

1. **Haz un backup** de tu base de datos antes de ejecutar el script
2. Los casos con fechas entre octubre 2025 y 14 enero 2026 **NO se modificarán**
3. Los demás casos se actualizarán o insertarán según corresponda
4. El campo `nmro_ajste` (nmroAjste) se usa como identificador único

## 🔧 Personalización

### Cambiar el rango de fechas a conservar

Edita estas constantes en el script:

```javascript
const FECHA_INICIO_CONSERVAR = new Date(2025, 9, 1); // Octubre 1, 2025
const FECHA_FIN_CONSERVAR = new Date(2026, 0, 14); // Enero 14, 2026
```

**Nota**: Los meses en JavaScript son 0-indexed (0 = enero, 9 = octubre)

### Cambiar la ruta por defecto del archivo

Edita esta constante en el script:

```javascript
const ARCHIVO_JSON = process.argv[2] || 'C:\\Users\\GP-TI\\Downloads\\gsk3c_appsiniestro.json';
```

## ❓ Solución de Problemas

### Error: "No se encontró el archivo"
- Verifica que la ruta del archivo sea correcta
- Usa comillas si la ruta tiene espacios: `"C:\Users\Mi Usuario\archivo.json"`
- En Windows, usa barras invertidas dobles o barras normales: `C:\\Users\\...` o `C:/Users/...`

### Error: "No se pudo encontrar el array de datos en el JSON"
- Verifica que el JSON tenga el formato de exportación de PHPMyAdmin
- El script busca un objeto con `type: "table"` y `data: [...]`
- Si el formato es diferente, puede ser necesario ajustar la función `leerJSON()`

### Error de conexión a MongoDB
- Verifica que la variable de entorno `MONGO_URI` esté configurada
- Verifica que MongoDB esté corriendo y accesible

### Casos no se conservan correctamente
- Verifica que las fechas en el JSON estén en formato `YYYY-MM-DD`
- El script verifica todas las fechas del registro, si alguna está en el rango, se conserva

## 📌 Notas

- El script procesa los registros de forma secuencial para evitar sobrecarga
- Se muestra progreso cada 100 registros procesados
- Los errores se registran pero no detienen el proceso completo
- Al final se muestra un resumen con todos los errores encontrados


