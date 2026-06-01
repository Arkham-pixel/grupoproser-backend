# Prueba de Alerta de Facturación

Este script permite probar la funcionalidad de alerta de facturación que envía notificaciones por email a **Iskharly** y **Elkin** cuando se suben documentos de control de horas en la sección de facturación de casos complex.

## ¿Qué hace este script?

1. Se conecta a la base de datos MongoDB
2. Busca los emails de Iskharly (login: 72007205) y Elkin (login: 72287602) en la base de datos
3. Si no los encuentra, usa los emails por defecto:
   - Iskharly: `itapia9@proserpuertos.com.co`
   - Elkin: `etapia@proserpuertos.com.co`
4. Envía un email de prueba a ambos destinatarios simulando la subida de un documento de control de horas

## Requisitos

- Node.js instalado
- Variables de entorno configuradas en `.env` o en el sistema:
  - `MONGO_URI`: URI de conexión a MongoDB
  - `EMAIL_USER`: Usuario del servicio de email
  - `EMAIL_PASS`: Contraseña del servicio de email
  - `EMAIL_SERVICE`: Servicio de email (opcional, por defecto 'gmail')

## Cómo ejecutar la prueba

### Opción 1: Desde la raíz del proyecto

```bash
cd backend
node test-alerta-facturacion.js
```

### Opción 2: Desde el directorio backend

```bash
node test-alerta-facturacion.js
```

## Qué esperar

El script mostrará en la consola:

1. ✅ Confirmación de variables de entorno
2. ✅ Confirmación de conexión a MongoDB
3. ✅ Información sobre los destinatarios
4. ✅ Resultado del envío del email
5. ✅ Message ID del email enviado (si fue exitoso)

## Verificación

Después de ejecutar el script:

1. **Revisa la consola** para ver si el email se envió correctamente
2. **Revisa los correos** de:
   - Iskharly: `itapia9@proserpuertos.com.co` (o el email configurado en BD)
   - Elkin: `etapia@proserpuertos.com.co` (o el email configurado en BD)
3. **Busca el asunto**: `⏰ Nuevo documento de control de horas - Caso TEST-2026-001`

## Datos de prueba

El script usa los siguientes datos de prueba:
- Número de caso: `TEST-2026-001`
- Número de siniestro: `SIN-2026-001`
- Archivos: `documento_prueba_1.pdf`, `documento_prueba_2.xlsx`
- Usuario: `usuario_prueba`

## Solución de problemas

### Error: "MONGO_URI no está definida"
- Verifica que el archivo `.env` existe en el directorio `backend/`
- Verifica que contiene la variable `MONGO_URI`

### Error: "EMAIL_USER no está definida"
- Verifica que el archivo `.env` contiene `EMAIL_USER` y `EMAIL_PASS`
- Verifica que las credenciales de email son correctas

### Error de conexión SMTP
- Verifica que las credenciales de email son correctas
- Verifica que el servicio de email está configurado correctamente
- Algunos servicios requieren "contraseñas de aplicación" en lugar de la contraseña normal

### El email no llega
- Revisa la carpeta de spam/correo no deseado
- Verifica que los emails de destino son correctos
- Revisa los logs del servidor de email para más detalles

## Notas importantes

- Este script **SÍ envía un email real** a Iskharly y Elkin
- El email será una notificación de prueba con datos ficticios
- El script no modifica ningún dato en la base de datos, solo lee información de usuarios
