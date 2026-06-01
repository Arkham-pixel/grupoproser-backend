# 📧 Configuración del Sistema de Email - Casos Complex

## 🎯 **Descripción**

Este sistema envía notificaciones automáticas por email cuando se crean o actualizan casos complex. Las notificaciones se envían a:

- **Responsables asignados** al caso (email obtenido desde la base de datos)
- **Funcionarios de aseguradoras** (email obtenido desde la base de datos)
- **Equipo de gestión** (emails fijos) ⚠️ **COMENTADOS PARA PRUEBAS**
- **Usuario que crea/actualiza el caso** (email del usuario logueado)

> **🔧 MODO PRUEBA ACTIVO:** Los emails fijos del equipo de gestión están comentados para hacer pruebas solo con responsables y funcionarios.

## ⚙️ **Configuración Requerida**

### **1. Variables de Entorno**

Crea un archivo `.env` en la carpeta `backend/` con:

```bash
# Servicio de Email
EMAIL_SERVICE=gmail

# Usuario de Email
EMAIL_USER=tu-email@gmail.com

# Contraseña de Aplicación (NO tu contraseña normal)
EMAIL_PASS=tu-contraseña-de-aplicacion

# Puerto del servidor
PORT=3000

# Base de datos MongoDB
MONGODB_URI=mongodb://localhost:27017/tu-base-de-datos

# JWT Secret
JWT_SECRET=tu-secret-jwt-super-seguro
```

### **2. Configuración de Gmail**

Para usar Gmail como servidor SMTP:

1. **Habilitar 2FA** en tu cuenta de Google
2. **Generar contraseña de aplicación**:
   - Ve a [myaccount.google.com](https://myaccount.google.com)
   - Seguridad > Verificación en dos pasos
   - Contraseñas de aplicación
   - Genera una nueva contraseña para "Sistema de Casos"
3. **Usa esa contraseña** en `EMAIL_PASS`

## 🚀 **Funcionalidades Implementadas**

### **✅ Creación de Casos Complex**
- Envío automático de notificaciones al crear un caso
- Notificación al responsable asignado (email desde BD)
- Notificación al equipo de gestión
- Notificación a la aseguradora (email desde BD, si hay funcionario asignado)
- Notificación al usuario que crea el caso

### **✅ Actualización de Casos Complex**
- Envío automático de notificaciones al actualizar
- Solo se envían si hay cambios relevantes:
  - Responsable
  - Aseguradora
  - Estado
  - Funcionario de aseguradora
- Los emails se obtienen automáticamente desde la base de datos

### **✅ Plantillas de Email Profesionales**
- Diseño HTML responsive
- Información completa del caso
- Datos del responsable
- Observaciones y detalles

## 🧪 **Pruebas del Sistema**

### **1. Prueba General de Email**
- Ruta: `/test-email`
- Envía email de prueba básico
- Verifica configuración SMTP

### **2. Prueba Específica de Complex**
- Ruta: `/test-email-complex`
- Envía email de prueba para casos complex
- Verifica integración completa

### **3. Prueba Automática**
- Crear un caso complex nuevo
- Verificar que se envíen las notificaciones
- Revisar logs del servidor

## 📋 **Logs del Servidor**

El sistema registra todas las operaciones de email:

```bash
📧 Iniciando envío de notificaciones por email...
📧 Datos para notificación: {...}
✅ Notificación de asignación enviada: {...}
✅ Notificación a aseguradora enviada: {...}
```

## 🔧 **Solución de Problemas**

### **❌ Error: "Invalid login"**
- Verifica que `EMAIL_USER` sea correcto
- Asegúrate de usar contraseña de aplicación, no la normal
- Verifica que 2FA esté habilitado

### **❌ Error: "Connection timeout"**
- Verifica conexión a internet
- Revisa firewall y antivirus
- Prueba con otro servicio SMTP

### **❌ Error: "Authentication failed"**
- Regenera contraseña de aplicación
- Verifica que no haya espacios en `.env`
- Reinicia el servidor después de cambios

## 📧 **Emails Fijos del Sistema**

Los siguientes emails están **COMENTADOS PARA PRUEBAS**:

- `etapia@proserpuertos.com.co` ⚠️ **COMENTADO**
- `aatapia@proserpuertos.com.co` ⚠️ **COMENTADO** 
- `itapia9@proserpuertos.com.co` ⚠️ **COMENTADO**

**Para pruebas, solo se envían emails a:**
- Responsable asignado al caso
- Funcionario de aseguradora
- Usuario que crea/actualiza el caso

**Para habilitar emails fijos nuevamente, descomenta las líneas en `emailService.js`**

## 🎯 **Próximas Mejoras**

- [ ] Plantillas personalizables por tipo de caso
- [ ] Configuración de horarios de envío
- [ ] Sistema de reintentos automáticos
- [ ] Dashboard de emails enviados
- [ ] Notificaciones push en tiempo real

## 🔧 **Habilitar Emails Fijos (Después de Pruebas)**

Cuando quieras volver a habilitar los emails fijos del equipo de gestión:

1. **Abre el archivo:** `backend/services/emailService.js`
2. **Busca la línea:** `// COMENTADOS PARA PRUEBAS - SOLO RESPONSABLE Y FUNCIONARIO`
3. **Descomenta las líneas:**
   ```javascript
   const emailsFijos = [
     'etapia@proserpuertos.com.co',        // ← Quitar //
     'aatapia@proserpuertos.com.co',       // ← Quitar //
     'itapia9@proserpuertos.com.co'        // ← Quitar //
   ];
   ```
4. **Reinicia el servidor backend**
5. **Los emails fijos volverán a recibir notificaciones**

## 📞 **Soporte**

Para problemas técnicos:
- Revisa los logs del servidor
- Verifica la configuración de `.env`
- Prueba con el componente de test
- Contacta al equipo de desarrollo
