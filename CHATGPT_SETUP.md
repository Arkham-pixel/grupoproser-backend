# 🤖 Configuración de ChatGPT

## 🎯 Descripción

Este sistema integra ChatGPT (OpenAI) para proporcionar asistencia inteligente en el formulario de ajustes. El chatbot puede ayudar a los usuarios a completar formularios, responder preguntas sobre campos específicos y proporcionar sugerencias basadas en el contexto del formulario.

## ⚙️ Configuración Requerida

### 1. Obtener API Key de OpenAI

1. Ve a [OpenAI Platform](https://platform.openai.com/)
2. Crea una cuenta o inicia sesión
3. Ve a **API Keys** en el menú
4. Haz clic en **"Create new secret key"**
5. Copia la API key (solo se muestra una vez)

### 2. Configurar Variables de Entorno

Agrega las siguientes variables al archivo `.env` en la carpeta `backend/`:

```bash
# API Key de OpenAI (requerida)
OPENAI_API_KEY=sk-tu-api-key-aqui

# Modelo de OpenAI a usar (opcional, por defecto: gpt-3.5-turbo)
# Opciones: gpt-3.5-turbo, gpt-4, gpt-4-turbo-preview
OPENAI_MODEL=gpt-3.5-turbo
```

### 3. Modelos Disponibles

- **gpt-3.5-turbo** (recomendado para desarrollo): Más económico, rápido
- **gpt-4**: Más inteligente pero más costoso
- **gpt-4-turbo-preview**: Versión mejorada de GPT-4

### 4. Costos

⚠️ **Importante**: El uso de la API de OpenAI tiene costos asociados:

- **gpt-3.5-turbo**: ~$0.002 por 1K tokens
- **gpt-4**: ~$0.03 por 1K tokens (entrada) + ~$0.06 por 1K tokens (salida)

**Recomendaciones:**
- Usa `gpt-3.5-turbo` para desarrollo y pruebas
- Configura límites de uso en tu cuenta de OpenAI
- Monitorea el uso regularmente

## 🚀 Funcionalidades

### ✅ Características Implementadas

1. **Asistencia Contextual**: El chatbot conoce el contexto del formulario actual
2. **Historial de Conversación**: Mantiene contexto de mensajes anteriores
3. **Fallback Inteligente**: Si ChatGPT no está configurado, usa respuestas predefinidas
4. **Manejo de Errores**: Muestra mensajes claros si hay problemas

### 📋 Endpoints Disponibles

- **POST `/api/chatgpt/chat`**: Enviar mensaje a ChatGPT
  - Requiere autenticación (token JWT)
  - Body: `{ message, formData, conversationHistory }`
  - Respuesta: `{ success, respuesta, modelo, tokens_usados }`

- **GET `/api/chatgpt/status`**: Verificar si ChatGPT está configurado
  - Requiere autenticación (token JWT)
  - Respuesta: `{ configurado, modelo, mensaje }`

## 🔧 Uso en el Frontend

El componente `ChatbotIA` detecta automáticamente si ChatGPT está configurado:

- ✅ **Si está configurado**: Usa ChatGPT para respuestas inteligentes
- ⚠️ **Si no está configurado**: Usa respuestas predefinidas (modo básico)

## 🛡️ Seguridad

- ✅ La API key se almacena solo en el servidor (`.env`)
- ✅ Todas las rutas requieren autenticación JWT
- ✅ El contexto del formulario se envía de forma segura
- ✅ No se almacenan conversaciones en la base de datos

## 📝 Notas

- El chatbot mantiene contexto de los últimos 10 mensajes
- Las respuestas están limitadas a 1000 tokens por defecto
- El sistema usa `temperature: 0.7` para respuestas balanceadas

## 🐛 Solución de Problemas

### Error: "OpenAI API Key no configurada"
- Verifica que `OPENAI_API_KEY` esté en el archivo `.env` del backend
- Reinicia el servidor después de agregar la variable

### Error: "Insufficient quota"
- Tu cuenta de OpenAI no tiene créditos suficientes
- Agrega créditos en [OpenAI Platform](https://platform.openai.com/account/billing)

### Error: "Rate limit exceeded"
- Has excedido el límite de solicitudes por minuto
- Espera unos minutos o actualiza tu plan en OpenAI

### El chatbot no responde
- Verifica que el servidor backend esté corriendo
- Revisa la consola del navegador para errores
- Verifica que el token JWT sea válido

