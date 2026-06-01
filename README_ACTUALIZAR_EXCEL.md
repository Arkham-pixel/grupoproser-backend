# Script de Actualización desde Excel

Este script permite actualizar información en la base de datos MongoDB desde un archivo Excel.

## 📋 Requisitos

1. Node.js instalado
2. Archivo Excel con los datos a actualizar
3. Variables de entorno configuradas (MONGO_URI en `.env` o `ecosystem.config.js`)

## 🚀 Uso Rápido

### 1. Preparar el archivo Excel

- Coloca tu archivo Excel en la carpeta `backend/` o especifica la ruta completa
- Asegúrate de que la primera fila contenga los nombres de las columnas
- Los nombres de las columnas deben coincidir con los definidos en `MAPEO_CAMPOS`

### 2. Configurar el script

Abre `backend/actualizar_desde_excel.js` y ajusta las siguientes configuraciones:

```javascript
// 1. Nombre del archivo Excel
const ARCHIVO_EXCEL = 'mi_archivo.xlsx';

// 2. Modelo a actualizar (importa el modelo necesario)
import Cliente from './models/Cliente.js';
const Modelo = Cliente;

// 3. Campo único para identificar documentos
const CAMPO_IDENTIFICADOR = 'correo'; // ej: 'correo', 'cedula', '_id'

// 4. Mapeo de columnas Excel → Campos BD
const MAPEO_CAMPOS = {
  'Correo': 'correo',
  'Razón Social': 'rzonSocial',
  'Teléfono': 'teleFijo',
  // ... más campos
};

// 5. Opciones
const OPCIONES = {
  crearSiNoExiste: false,        // true = crea nuevos si no existen
  mostrarResumen: true,          // true = muestra resumen al final
  validarAntesDeActualizar: true // true = solo muestra vista previa
};
```

### 3. Ejecutar el script

#### Modo Validación (recomendado primero)
Con `validarAntesDeActualizar: true`, el script solo muestra una vista previa:

```bash
cd backend
node actualizar_desde_excel.js
```

Esto te permitirá verificar que el mapeo es correcto antes de hacer cambios.

#### Modo Ejecución
Una vez verificado, cambia `validarAntesDeActualizar: false` y ejecuta de nuevo:

```bash
node actualizar_desde_excel.js
```

## 📝 Ejemplos de Configuración

### Ejemplo 1: Actualizar Clientes

```javascript
import Cliente from './models/Cliente.js';

const ARCHIVO_EXCEL = 'clientes_actualizar.xlsx';
const Modelo = Cliente;
const CAMPO_IDENTIFICADOR = 'correo';

const MAPEO_CAMPOS = {
  'Correo': 'correo',
  'Código Aseguradora': 'codiAsgrdra',
  'Razón Social': 'rzonSocial',
  'Teléfono Fijo': 'teleFijo',
  'Teléfono Celular': 'teleCellar',
  'Dirección': 'direCliente',
};
```

### Ejemplo 2: Actualizar Usuarios

```javascript
import Usuario from './models/Usuario.js';

const ARCHIVO_EXCEL = 'usuarios_actualizar.xlsx';
const Modelo = Usuario;
const CAMPO_IDENTIFICADOR = 'correo';

const MAPEO_CAMPOS = {
  'Correo': 'correo',
  'Nombre': 'nombre',
  'Rol': 'rol',
  'Celular': 'celular',
  'Cédula': 'cedula',
};
```

### Ejemplo 3: Actualizar por ID

```javascript
const CAMPO_IDENTIFICADOR = '_id';

const MAPEO_CAMPOS = {
  'ID': '_id',  // El Excel debe tener una columna 'ID' con los _id de MongoDB
  'Campo1': 'campo1',
  'Campo2': 'campo2',
};
```

## ⚙️ Opciones Avanzadas

### Crear documentos si no existen

```javascript
const OPCIONES = {
  crearSiNoExiste: true,  // Crea nuevos documentos si no se encuentran
  // ...
};
```

### Usar una hoja específica del Excel

```javascript
const NOMBRE_HOJA = 'Datos Clientes';  // Nombre exacto de la hoja
```

### Ruta completa del archivo

```javascript
const ARCHIVO_EXCEL = 'C:/ruta/completa/mi_archivo.xlsx';
```

## 🔍 Solución de Problemas

### Error: "No se encontró el archivo"
- Verifica que el archivo esté en la carpeta `backend/`
- O especifica la ruta completa en `ARCHIVO_EXCEL`

### Error: "No se encontró la hoja"
- Verifica el nombre exacto de la hoja en el Excel
- O deja `NOMBRE_HOJA = null` para usar la primera hoja

### Error: "No se encontró el campo identificador"
- Verifica que el Excel tenga una columna que coincida con `CAMPO_IDENTIFICADOR`
- El nombre de la columna debe estar en `MAPEO_CAMPOS` o ser exactamente igual a `CAMPO_IDENTIFICADOR`

### Los datos no se actualizan
- Verifica que `validarAntesDeActualizar` esté en `false`
- Revisa que el `CAMPO_IDENTIFICADOR` exista en los documentos de la BD
- Verifica que los valores del identificador en el Excel coincidan exactamente con los de la BD

## 📊 Formato del Excel

El Excel debe tener:
- Primera fila: Nombres de columnas (headers)
- Filas siguientes: Datos a actualizar
- Los nombres de las columnas deben coincidir con los definidos en `MAPEO_CAMPOS`

Ejemplo:

| Correo | Razón Social | Teléfono Fijo | Teléfono Celular |
|--------|--------------|---------------|------------------|
| cliente1@email.com | Empresa 1 | 1234567 | 3001234567 |
| cliente2@email.com | Empresa 2 | 7654321 | 3007654321 |

## ⚠️ Importante

1. **Siempre haz un backup** de tu base de datos antes de ejecutar actualizaciones masivas
2. **Usa el modo validación primero** (`validarAntesDeActualizar: true`) para verificar el mapeo
3. **Verifica el campo identificador** - debe ser único y existir en los documentos
4. **Revisa el mapeo de campos** - los nombres de las columnas del Excel deben coincidir exactamente

## 📞 Soporte

Si tienes problemas:
1. Verifica que todas las configuraciones estén correctas
2. Ejecuta en modo validación primero
3. Revisa los mensajes de error en la consola
4. Verifica que el modelo y los campos existan en la base de datos

