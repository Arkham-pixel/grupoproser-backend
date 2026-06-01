# 📋 Guía: Limpiar Responsables Duplicados

## 🔍 Problema Identificado

En la base de datos existen responsables con nombres duplicados pero con diferente capitalización:
- Ejemplo: "Maria Garcias" y "MARIA GARCIAS"

Esto causa problemas en:
1. **Filtros del reporte**: Aparecen opciones duplicadas
2. **Exportación de Excel**: No se muestran todos los casos porque el filtro solo captura una variación del nombre
3. **Búsquedas**: Resultados inconsistentes

## ✅ Solución Implementada (Frontend)

### Cambios en `ReporteRiesgo.jsx`

Se implementó una normalización automática en el frontend que:

1. **Normaliza nombres**: Convierte todos los nombres a formato "Primera Letra Mayúscula"
   - "MARIA GARCIAS" → "Maria Garcias"
   - "maria garcias" → "Maria Garcias"

2. **Elimina duplicados**: Agrupa todos los códigos que tienen el mismo nombre normalizado

3. **Mejora el filtrado**: Cuando seleccionas un responsable, muestra TODOS los casos asociados independientemente de cómo esté escrito en la BD

### Resultados Inmediatos

✅ El filtro de responsables ahora muestra nombres únicos sin duplicados  
✅ Al seleccionar un responsable, se muestran TODOS sus casos  
✅ La exportación a Excel incluye todos los datos correctamente

## 🔧 Limpieza de Base de Datos (Opcional)

Si deseas limpiar los duplicados directamente en la base de datos, usa el script proporcionado:

### Paso 1: Generar Reporte

```bash
cd backend/scripts
node limpiar-responsables-duplicados.js reporte
```

Esto mostrará todos los duplicados sin hacer cambios.

### Paso 2: Normalizar Nombres (Seguro)

```bash
node limpiar-responsables-duplicados.js normalizar
```

Esto actualiza todos los nombres al formato normalizado sin eliminar registros.

### Paso 3: Consolidar (Avanzado - Requiere Precaución)

⚠️ **ADVERTENCIA**: Este paso elimina registros duplicados. Úsalo solo si:
- Has hecho un backup de la base de datos
- Has verificado que no hay referencias importantes
- Entiendes el impacto

```bash
node limpiar-responsables-duplicados.js consolidar
```

## 📊 Antes y Después

### Antes
```
Filtro de Responsables:
- Maria Garcias (47 casos)
- MARIA GARCIAS (23 casos)
- maria garcias (5 casos)
```

### Después
```
Filtro de Responsables:
- Maria Garcias (75 casos)  ← Todos los casos unificados
```

## 🛠️ Mantenimiento Preventivo

Para evitar duplicados futuros:

1. **Al crear nuevos responsables**: El sistema debería validar que no existan nombres similares
2. **Al importar datos**: Normalizar nombres antes de insertar
3. **Validación en formularios**: Convertir a formato estándar antes de guardar

## 📝 Recomendaciones

1. ✅ La solución del frontend es suficiente para operación normal
2. ⚠️ La limpieza de BD es opcional pero recomendada para largo plazo
3. 🔒 Siempre haz backup antes de ejecutar scripts de consolidación
4. 📧 Verifica que los emails estén correctos antes de consolidar

## 🆘 Soporte

Si encuentras problemas:
1. Revisa los logs de la consola del navegador
2. Verifica que el script de limpieza se ejecutó correctamente
3. Comprueba que las referencias en casos de riesgo estén actualizadas
