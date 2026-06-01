# Correo y alertas en producción

Las notificaciones (control de horas, alertas diarias, asignación de casos, etc.) usan **un solo buzón SMTP** configurado en `backend/.env` del servidor.

## Por qué “se caen” las alertas

El error `535 Username and Password not accepted` significa que **Google rechazó usuario o contraseña**. No es un bug del frontend: hay que corregir credenciales en el servidor y reiniciar el backend.

Causas frecuentes:

1. `EMAIL_PASS` es la contraseña normal de la cuenta (no sirve).
2. La contraseña de aplicación fue revocada o regenerada y no se actualizó el `.env`.
3. El `.env` del servidor no es el que cree el equipo (falta copiar variables a producción).
4. No se reinició PM2 después de editar `.env`.

## Configuración recomendada (estable)

### 1. Cuenta dedicada

Use una cuenta solo para el sistema, por ejemplo `sistema@proserpuertos.com.co` o un Gmail/Workspace de servicio. No use la cuenta personal de un empleado.

### 2. Contraseña de aplicación (Google)

1. Activar verificación en 2 pasos en la cuenta.
2. Ir a [Contraseñas de aplicación](https://myaccount.google.com/apppasswords).
3. Crear una para “Grupo Proser API”.
4. Copiar los 16 caracteres **sin espacios** a `EMAIL_PASS`.

### 3. Archivo `backend/.env` en el servidor

```env
EMAIL_SERVICE=gmail
EMAIL_USER=sistema@proserpuertos.com.co
EMAIL_PASS=xxxxxxxxxxxxxxxx
EMAIL_FROM=sistema@proserpuertos.com.co
EMAIL_FROM_NAME=Grupo Proser
```

### 4. Reiniciar el backend

```bash
pm2 restart grupo-proser-backend
pm2 logs grupo-proser-backend --lines 50
```

Al arrancar debe aparecer: `✅ [correo] SMTP verificado al arrancar`.

Si aparece error de credenciales, las alertas **no** se enviarán hasta corregir el `.env`.

## Comprobar estado sin enviar correos

```http
GET https://aplicacion.grupoproser.com.co/api/health/email
```

Respuesta útil:

- `mail.configured`: hay `EMAIL_USER` y `EMAIL_PASS`.
- `mail.lastStartupCheck.ok`: SMTP autenticó al último arranque.
- `outbox.pending`: correos en cola esperando reintento.

Forzar verificación SMTP:

```http
POST https://aplicacion.grupoproser.com.co/api/health/email/verify
```

## Cola de reintentos (nuevo)

Si un envío falla por red o saturación, el correo se guarda en MongoDB (`EmailOutbox`) y un cron lo reintenta cada 5 minutos (hasta 10 intentos).

- **No reintenta** si el error es de credenciales (535): hay que arreglar `.env`.
- Variables: `EMAIL_OUTBOX_ENABLED=true` (por defecto), `EMAIL_OUTBOX_CRON=*/5 * * * *`.

## Prueba de control de horas

En el servidor, con el mismo `.env`:

```bash
cd backend
node test-alerta-facturacion.js
```

## Alternativa más robusta (opcional)

Para no depender de Gmail, puede usar SMTP de su hosting o un proveedor transaccional (SendGrid, Amazon SES, Resend) con:

```env
SMTP_HOST=smtp.ejemplo.com
SMTP_PORT=587
SMTP_SECURE=false
EMAIL_USER=...
EMAIL_PASS=...
```

## Checklist mensual

- [ ] `GET /api/health/email` → `lastStartupCheck.ok: true`
- [ ] Probar `node test-alerta-facturacion.js` en el servidor
- [ ] Revisar `outbox.failed` en health (debe ser 0 o bajo)
- [ ] Confirmar que nadie revocó la contraseña de aplicación en Google
