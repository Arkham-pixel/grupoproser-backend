# 📊 Generación de Sesiones Históricas

Este script genera sesiones históricas aproximadas basándose en la actividad de los usuarios en los últimos 15 días.

## 🎯 ¿Qué hace?

El script analiza la actividad histórica de los usuarios en:
- **HistorialFormulario**: Formularios creados por usuarios
- **Complex**: Casos Complex creados
- **Tareas**: Tareas creadas por usuarios

Y genera sesiones aproximadas estimando:
- **Hora de inicio**: Basada en la primera actividad del día
- **Duración**: Estimada según la cantidad y tipo de actividades
  - Formularios: ~20 minutos cada uno
  - Casos: ~25 minutos cada uno
  - Tareas: ~5 minutos cada una
  - Mínimo: 30 minutos por sesión
  - Máximo: 8 horas por sesión

## 🚀 Cómo ejecutar

### Opción 1: Usando npm script
```bash
cd backend
npm run generar-sesiones-historicas
```

### Opción 2: Ejecutar directamente
```bash
cd backend
node generar_sesiones_historicas.js
```

## ⚙️ Requisitos

1. **MongoDB debe estar corriendo** y accesible
2. **Variable de entorno MONGO_URI** debe estar configurada en `.env`
3. **Base de datos debe tener datos históricos** de los últimos 15 días

## 📋 Proceso

1. El script se conecta a MongoDB
2. Obtiene todos los usuarios activos
3. Analiza la actividad de los últimos 15 días
4. Agrupa la actividad por usuario y día
5. Genera sesiones históricas estimadas
6. Las inserta en la colección `sesionesUsuarios`

## ⚠️ Notas importantes

- **No duplica sesiones**: Si ya existe una sesión para un usuario en un día específico, la omite
- **Datos aproximados**: Las duraciones son estimaciones basadas en la actividad, no tiempos reales
- **Solo usuarios activos**: Solo procesa usuarios con `active: 'Y'`
- **Período fijo**: Analiza los últimos 15 días desde la fecha de ejecución

## 📊 Resultado

Después de ejecutar el script, verás:
- Número de sesiones creadas
- Número de sesiones omitidas (ya existían)
- Ejemplos de sesiones generadas
- Resumen de la actividad procesada

## 🔄 Re-ejecutar

Puedes ejecutar el script múltiples veces de forma segura. Solo creará sesiones para días que aún no tienen sesiones registradas.

## 🐛 Solución de problemas

Si encuentras errores:

1. **Error de conexión a MongoDB**: Verifica que MongoDB esté corriendo y que MONGO_URI sea correcta
2. **No se generan sesiones**: Verifica que haya actividad histórica en los últimos 15 días
3. **Sesiones duplicadas**: El script automáticamente evita duplicados, pero si necesitas limpiar, puedes eliminar manualmente las sesiones con `ip: 'historical'`

## 📝 Ejemplo de salida

```
🔄 Iniciando generación de sesiones históricas...

📊 Usuarios activos encontrados: 10

📅 Período analizado: 15/11/2024 - 30/11/2024

📝 Analizando HistorialFormulario...
   ✅ 45 formularios encontrados
📋 Analizando casos Complex...
   ✅ 12 casos Complex encontrados
⚠️ Analizando casos de Riesgo...
   ✅ 8 casos de Riesgo encontrados
✅ Analizando tareas...
   ✅ 23 tareas encontradas

📊 Días con actividad encontrados: 28

   ✅ 10 sesiones creadas...
   ✅ 20 sesiones creadas...

📊 Resumen de generación:
   ✅ Sesiones creadas: 28
   ⏭️  Sesiones omitidas (ya existían): 0
   📅 Total de días con actividad: 28

📋 Ejemplos de sesiones generadas:
   • Juan Pérez - 20/11/2024 - 120m (5 actividades)
   • María García - 21/11/2024 - 85m (3 actividades)
   ...

✅ Proceso completado exitosamente!
```

