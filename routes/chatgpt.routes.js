import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { verificarToken } from '../middleware/auth.js';

dotenv.config();

const router = express.Router();

// Inicializar cliente de OpenAI
// Verificar que la API key esté disponible
const apiKey = process.env.OPENAI_API_KEY || '';
if (!apiKey) {
  console.error('❌ OPENAI_API_KEY no está definida en las variables de entorno');
} else {
  console.log('✅ OPENAI_API_KEY cargada, longitud:', apiKey.length);
}

const openai = new OpenAI({
  apiKey: apiKey
});

// Endpoint para enviar mensajes a ChatGPT
router.post('/chat', verificarToken, async (req, res) => {
  try {
    const { message, formData, conversationHistory } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ 
        error: 'El mensaje es requerido' 
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ OPENAI_API_KEY no está configurada');
      return res.status(500).json({ 
        error: 'OpenAI API Key no configurada. Configure OPENAI_API_KEY en el archivo .env' 
      });
    }

    // Verificar que la API key tenga el formato correcto
    if (!process.env.OPENAI_API_KEY.startsWith('sk-')) {
      console.error('⚠️ La API key no tiene el formato correcto (debe empezar con sk-)');
    }

    console.log('✅ API Key detectada, longitud:', process.env.OPENAI_API_KEY.length);

    // Construir el contexto del formulario para ChatGPT
    const contextoFormulario = formData ? `
**Contexto actual del formulario:**

**Datos Generales:**
- Destinatario: ${formData.destinatario || 'Vacío'}
- Cargo: ${formData.cargo || 'Vacío'}
- Empresa: ${formData.empresa || 'Vacío'}
- Dirección: ${formData.direccion || 'Vacío'}
- Ciudad: ${formData.ciudad || 'Vacío'}
- Departamento: ${formData.departamento || 'Vacío'}
- Teléfono: ${formData.telefono || 'Vacío'}
- Email: ${formData.email || 'Vacío'}

**Información del Siniestro:**
- Fecha de Ocurrencia: ${formData.fechaOcurrencia || 'Vacío'}
- Hora de Ocurrencia: ${formData.horaOcurrencia || 'Vacío'}
- Número de Siniestro: ${formData.numeroSiniestro || 'Vacío'}
- Número de Póliza: ${formData.numeroPoliza || 'Vacío'}
- Aseguradora: ${formData.aseguradora || 'Vacío'}
- Tipo de Evento: ${formData.tipoEvento || 'Vacío'}
- Tipo de Siniestro: ${formData.tipoSiniestro || 'Vacío'}
- Asegurado: ${formData.asegurado || 'Vacío'}
- Tomador: ${formData.tomador || 'Vacío'}
- Beneficiario: ${formData.beneficiario || 'Vacío'}

**Descripción y Antecedentes:**
- Descripción del Siniestro: ${formData.descripcionSiniestro ? (formData.descripcionSiniestro.substring(0, 150) + '...') : 'Vacío'}
- Antecedentes: ${formData.antecedentes ? (formData.antecedentes.substring(0, 150) + '...') : 'Vacío'}
- Circunstancias del Siniestro: ${formData.circunstanciasSiniestro ? (formData.circunstanciasSiniestro.substring(0, 150) + '...') : 'Vacío'}
- Causa: ${formData.causa || 'Vacío'}

**Ubicación del Riesgo:**
- Dirección del Riesgo: ${formData.direccionRiesgo || 'Vacío'}
- Coordenadas: ${formData.coordenadasRiesgo || 'Vacío'}
- Descripción del Riesgo: ${formData.descripcionRiesgo ? (formData.descripcionRiesgo.substring(0, 100) + '...') : 'Vacío'}

**Valores:**
- Valor Asegurado: ${formData.valorAsegurado || 'Vacío'}
- Valor del Siniestro: ${formData.valorSiniestro || 'Vacío'}
- Reserva Sugerida: ${formData.reservaSugerida || 'Vacío'}

**Inspección:**
- Fecha de Inspección: ${formData.fechaInspeccion || 'Vacío'}
- Inspector: ${formData.inspector || 'Vacío'}
- Descripción de Inspección: ${formData.descripcionInspeccion ? (formData.descripcionInspeccion.substring(0, 100) + '...') : 'Vacío'}
- Conclusiones: ${formData.conclusiones ? (formData.conclusiones.substring(0, 100) + '...') : 'Vacío'}

**Versión Preeliminar:**
- Observaciones Preeliminares: ${formData.observacionesPreeliminar ? (formData.observacionesPreeliminar.substring(0, 100) + '...') : 'Vacío'}
- Análisis de Cobertura: ${formData.analisisCobertura ? (formData.analisisCobertura.substring(0, 100) + '...') : 'Vacío'}

**Estado del formulario:** ${formData.estadoActual || 'inicial'}
` : '';

    // Construir historial de conversación
    const messages = [];
    
    // Construir lista de campos disponibles del formulario (campos editables)
    const camposEditables = [
      // Datos generales
      'destinatario', 'cargo', 'empresa', 'direccion', 'ciudad', 'departamento', 
      'telefono', 'email', 'fechaSiniestro', 'fechaOcurrencia', 'horaSiniestro', 
      'horaOcurrencia', 'numeroSiniestro', 'numeroPoliza', 'aseguradora', 'ramo',
      'vigenciaDesde', 'vigenciaHasta', 'asegurado', 'tomador', 'beneficiario',
      'tipoSiniestro', 'tipoEvento', 'funcionarioAsigna',
      // Descripción y antecedentes
      'descripcionSiniestro', 'antecedentes', 'actividad', 'ciudadDestino', 
      'paisDestino', 'numeroReporte', 'versionReporte', 'codigoReporte',
      // Valores y ubicación
      'valorAsegurado', 'valorSiniestro', 'direccionRiesgo', 'coordenadasRiesgo', 
      'codigoPostal', 'fechaReporte', 'descripcionRiesgo',
      // Siniestro y causa
      'circunstanciasSiniestro', 'causa', 'reservaSugerida',
      // Inspección
      'fechaInspeccion', 'horaInspeccion', 'inspector', 'descripcionInspeccion',
      'conclusiones', 'recomendaciones',
      // Versión preeliminar
      'observacionesPreeliminar', 'analisisCobertura', 'observacionesGenerales',
      // Análisis de cobertura
      'analisisPoliza', 'coberturasAplicables', 'exclusiones', 'garantias', 'coaseguro',
      // Observaciones generales
      'solicitudDocumentos', 'declinacion', 'proximosPasos',
      // Versión de actualización
      'fechaActualizacion', 'cambiosDesdePreeliminar', 'nuevaInformacion', 
      'observacionesActualizacion',
      // Informe final
      'fechaInformeFinal', 'conclusionesFinales', 'recomendacionesFinales', 
      'observacionesInformeFinal',
      // Campos finales
      'salvamentos', 'panoramaRiesgos'
    ];
    
    // Filtrar campos que realmente existen en formData
    const camposDisponibles = camposEditables.filter(campo => 
      formData && formData.hasOwnProperty(campo)
    ).join(', ');

    // Mensaje del sistema con instrucciones
    messages.push({
      role: 'system',
      content: `Eres un asistente experto en formularios de ajuste de seguros. Tu función es ayudar a los usuarios a completar formularios de siniestros de seguros de manera eficiente y precisa.

${contextoFormulario}

**IMPORTANTE: Puedes llenar campos del formulario automáticamente**

Cuando el usuario te dé información o te pida llenar campos, puedes responder en dos formatos:

1. **Formato normal (solo texto)**: Para explicaciones y ayuda general
2. **Formato especial con acciones**: Para llenar campos automáticamente

**Formato especial para llenar campos:**
Si el usuario te da datos o te pide llenar un campo, responde con este formato JSON al final de tu respuesta:

\`\`\`json
{
  "acciones": [
    {
      "campo": "nombreDelCampo",
      "valor": "valor a llenar",
      "tipo": "texto|numero|fecha"
    }
  ]
}
\`\`\`

**Campos disponibles del formulario:**
${camposDisponibles || 'ciudad, departamento, aseguradora, tipoEvento, fechaOcurrencia, descripcionSiniestro, antecedentes, observacionesPreeliminar, analisisCobertura, reservaSugerida, etc.'}

**Ejemplos de uso:**

Ejemplo 1:
Usuario: "El siniestro fue un incendio el 15 de enero de 2024 en Bogotá, Cundinamarca"
Respuesta: "Entendido. He registrado la información del siniestro: tipo de evento, fecha y ubicación."
\`\`\`json
{
  "acciones": [
    {"campo": "tipoEvento", "valor": "Incendio", "tipo": "texto"},
    {"campo": "fechaOcurrencia", "valor": "2024-01-15", "tipo": "fecha"},
    {"campo": "ciudad", "valor": "Bogotá", "tipo": "texto"},
    {"campo": "departamento", "valor": "Cundinamarca", "tipo": "texto"}
  ]
}
\`\`\`

Ejemplo 2:
Usuario: "Llena el campo de antecedentes con: El siniestro ocurrió a las 3am cuando se detectó humo en el área de almacenamiento. Los empleados activaron la alarma inmediatamente."
Respuesta: "He llenado el campo de antecedentes con la información proporcionada."
\`\`\`json
{
  "acciones": [
    {"campo": "antecedentes", "valor": "El siniestro ocurrió a las 3am cuando se detectó humo en el área de almacenamiento. Los empleados activaron la alarma inmediatamente.", "tipo": "texto"}
  ]
}
\`\`\`

Ejemplo 3:
Usuario: "Es un robo, ocurrió ayer a las 10pm, la aseguradora es Seguros Bolívar"
Respuesta: "He registrado el tipo de evento, fecha y aseguradora."
\`\`\`json
{
  "acciones": [
    {"campo": "tipoEvento", "valor": "Robo", "tipo": "texto"},
    {"campo": "fechaOcurrencia", "valor": "${new Date(Date.now() - 86400000).toISOString().split('T')[0]}", "tipo": "fecha"},
    {"campo": "horaOcurrencia", "valor": "22:00", "tipo": "texto"},
    {"campo": "aseguradora", "valor": "Seguros Bolívar", "tipo": "texto"}
  ]
}
\`\`\`

**Mapeo de palabras clave a campos (importante para entender qué llenar):**

**Tipo de Evento:**
- "incendio", "fuego", "quema" → tipoEvento: "Incendio"
- "robo", "hurto", "asalto", "sustracción" → tipoEvento: "Robo"
- "inundación", "agua", "lluvia", "creciente" → tipoEvento: "Inundación"
- "accidente", "choque", "colisión" → tipoEvento: "Accidente"
- "terremoto", "sismo" → tipoEvento: "Terremoto"
- "vandalismo", "daño" → tipoEvento: "Vandalismo"

**Fechas y Horas:**
- Fechas mencionadas (ej: "15 de enero", "ayer", "hoy") → fechaOcurrencia (formato: YYYY-MM-DD)
- Horas mencionadas (ej: "3am", "10pm", "15:30") → horaOcurrencia (formato: HH:MM)

**Ubicación:**
- Nombres de ciudades → ciudad
- Nombres de departamentos → departamento
- Direcciones mencionadas → direccionRiesgo o direccion
- Coordenadas → coordenadasRiesgo

**Aseguradora y Póliza:**
- Nombres de aseguradoras (ej: "Seguros Bolívar", "Sura") → aseguradora
- Números de póliza → numeroPoliza
- Números de siniestro → numeroSiniestro

**Personas:**
- "asegurado", "cliente" → asegurado
- "tomador" → tomador
- "beneficiario" → beneficiario
- "destinatario" → destinatario

**Descripciones:**
- "antecedentes", "qué pasó antes", "historial" → antecedentes
- "descripción del siniestro", "qué ocurrió" → descripcionSiniestro
- "circunstancias", "cómo ocurrió" → circunstanciasSiniestro
- "causa", "motivo" → causa
- "observaciones", "hallazgos" → observacionesPreeliminar
- "análisis", "cobertura" → analisisCobertura
- "conclusiones" → conclusiones
- "recomendaciones" → recomendaciones

**Valores:**
- "reserva", "monto sugerido", "valor reserva" → reservaSugerida
- "valor asegurado" → valorAsegurado
- "valor siniestro", "pérdida" → valorSiniestro

**Inspección:**
- "fecha inspección" → fechaInspeccion
- "inspector", "quien inspecciona" → inspector
- "descripción inspección" → descripcionInspeccion

**Instrucciones:**
- Proporciona respuestas claras y concisas
- Si el usuario te da datos específicos, úsalos para llenar los campos correspondientes
- Si el usuario pregunta sobre un campo, explica y ofrece llenarlo si tiene la información
- Mantén un tono profesional pero amigable
- Siempre incluye el JSON de acciones cuando vayas a llenar campos
- Si no estás seguro de qué campo usar, pregunta al usuario

Responde en español y sé específico con ejemplos cuando sea apropiado.`
    });

    // Agregar historial de conversación si existe
    if (conversationHistory && Array.isArray(conversationHistory)) {
      conversationHistory.forEach(msg => {
        if (msg.tipo === 'usuario') {
          messages.push({
            role: 'user',
            content: msg.contenido
          });
        } else if (msg.tipo === 'ia') {
          messages.push({
            role: 'assistant',
            content: msg.contenido
          });
        }
      });
    }

    // Agregar el mensaje actual
    messages.push({
      role: 'user',
      content: message
    });

    // Llamar a la API de OpenAI
    const modelo = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
    console.log('🤖 Llamando a OpenAI con modelo:', modelo);
    console.log('📝 Número de mensajes:', messages.length);
    
    const completion = await openai.chat.completions.create({
      model: modelo,
      messages: messages,
      temperature: 0.7,
      max_tokens: 1000
    });
    
    console.log('✅ Respuesta recibida de OpenAI');

    const respuesta = completion.choices[0].message.content;

    // Intentar extraer acciones JSON de la respuesta
    let acciones = [];
    let respuestaLimpia = respuesta;
    
    try {
      // Buscar bloques de código JSON en la respuesta
      const jsonMatch = respuesta.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const jsonData = JSON.parse(jsonMatch[1]);
        if (jsonData.acciones && Array.isArray(jsonData.acciones)) {
          acciones = jsonData.acciones;
          // Remover el JSON de la respuesta para mostrar solo el texto
          respuestaLimpia = respuesta.replace(/```json\s*[\s\S]*?\s*```/g, '').trim();
        }
      }
    } catch (error) {
      console.log('⚠️ No se encontraron acciones JSON en la respuesta o formato inválido');
    }

    res.json({
      success: true,
      respuesta: respuestaLimpia,
      acciones: acciones, // Array de acciones para llenar campos
      modelo: completion.model,
      tokens_usados: completion.usage?.total_tokens || 0
    });

  } catch (error) {
    console.error('❌ Error al comunicarse con ChatGPT:', error);
    console.error('📋 Stack:', error.stack);
    
    // Manejar errores específicos de OpenAI
    if (error.response) {
      console.error('📡 Respuesta de OpenAI:', error.response.status, error.response.data);
      
      const errorData = error.response.data?.error || {};
      const statusCode = error.response.status || 500;
      
      // Manejar error 429 (quota exceeded) de forma especial
      if (statusCode === 429) {
        return res.status(429).json({
          error: 'Cuota de OpenAI excedida',
          mensaje: 'Has excedido tu cuota actual de OpenAI. Por favor, verifica tu plan y detalles de facturación.',
          detalles: errorData.message || 'Quota exceeded',
          codigo: errorData.code || 'rate_limit_exceeded',
          solucion: 'Agrega créditos en https://platform.openai.com/account/billing o actualiza tu plan'
        });
      }
      
      return res.status(statusCode).json({
        error: errorData.message || 'Error al comunicarse con ChatGPT',
        detalles: errorData,
        codigo: errorData.code
      });
    }

    // Manejar errores de red o otros
    if (error.message) {
      console.error('💬 Mensaje de error:', error.message);
    }

    res.status(500).json({
      error: 'Error interno del servidor al procesar la solicitud',
      detalles: error.message || 'Error desconocido',
      tipo: error.name || 'Error'
    });
  }
});

// Endpoint para verificar si la API key está configurada
router.get('/status', verificarToken, (req, res) => {
  const tieneApiKey = !!process.env.OPENAI_API_KEY;
  res.json({
    configurado: tieneApiKey,
    modelo: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
    mensaje: tieneApiKey 
      ? 'ChatGPT está configurado y listo para usar' 
      : 'OpenAI API Key no configurada. Configure OPENAI_API_KEY en el archivo .env'
  });
});

export default router;

