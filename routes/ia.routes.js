import { Router } from 'express';
import { verificarToken } from '../middleware/auth.js';
import { arnaldIaHabilitado } from '../config/arnaldFeatures.js';
import { chatConRotacion, estadoGatewayIa } from '../services/ia/iaGateway.js';
import {
  construirContextoCasoIa,
  parseSugerenciasInforme,
  promptChatConEvidencias,
  promptSugerirCamposInforme,
} from '../services/ia/casoIaService.js';

const router = Router();

const AYUDA_KEYS =
  'Si falla: revise GEMINI_API_KEY (visión de fotos/PDF) o GROQ_API_KEY en el .env y reinicie el backend.';

router.get('/status', verificarToken, (req, res) => {
  res.json({ success: true, data: estadoGatewayIa() });
});

router.post('/chat', verificarToken, async (req, res) => {
  if (!arnaldIaHabilitado()) {
    return res.status(503).json({
      success: false,
      code: 'IA_DISABLED',
      error: 'Arnald IA aún no está habilitada.',
    });
  }
  try {
    const modulo = String(req.body?.modulo || '').trim();
    const casoId = String(req.body?.casoId || '').trim();
    let messages = req.body?.messages;
    let adjuntos = [];
    let preferredProvider = req.body?.preferredProvider;

    // Si hay caso: cargar fotos + PDF y forzar prompt con evidencias
    if (modulo && casoId) {
      const ctx = await construirContextoCasoIa(modulo, casoId, { conBinarios: true });
      if (!ctx) {
        return res.status(404).json({ success: false, error: 'Caso no encontrado' });
      }
      adjuntos = ctx.adjuntos || [];
      const pregunta =
        [...(Array.isArray(messages) ? messages : [])]
          .reverse()
          .find((m) => m.role === 'user')?.content || String(req.body?.pregunta || '').trim();
      messages = promptChatConEvidencias(pregunta || 'Redacta conclusiones y recomendaciones', ctx.texto);
      preferredProvider = preferredProvider || 'gemini';
    }

    const result = await chatConRotacion({
      messages,
      preferredProvider,
      model: req.body?.model,
      adjuntos,
      requireVision: adjuntos.length > 0,
    });
    res.json({
      success: true,
      data: {
        ...result,
        nAdjuntos: adjuntos.length,
      },
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      code: error.code || 'IA_ERROR',
      error: error.message,
      intentos: error.intentos || undefined,
      ayuda: AYUDA_KEYS,
    });
  }
});

router.post('/caso/sugerir-informe', verificarToken, async (req, res) => {
  if (!arnaldIaHabilitado()) {
    return res.status(503).json({
      success: false,
      code: 'IA_DISABLED',
      error: 'Arnald IA deshabilitada',
    });
  }
  try {
    const modulo = String(req.body?.modulo || '').trim();
    const casoId = String(req.body?.casoId || '').trim();
    if (!modulo || !casoId) {
      return res.status(400).json({ success: false, error: 'modulo y casoId son obligatorios' });
    }
    const ctx = await construirContextoCasoIa(modulo, casoId, { conBinarios: true });
    if (!ctx) {
      return res.status(404).json({ success: false, error: 'Caso no encontrado' });
    }
    if (!ctx.nAdjuntos) {
      return res.status(422).json({
        success: false,
        code: 'SIN_EVIDENCIAS',
        error:
          'No se pudieron leer fotos ni PDF del caso. Suba evidencias al archivero o verifique S3.',
      });
    }
    const result = await chatConRotacion({
      messages: promptSugerirCamposInforme(ctx.texto),
      preferredProvider: 'gemini',
      adjuntos: ctx.adjuntos,
      requireVision: true,
    });
    const sugerencias = parseSugerenciasInforme(result.text);
    res.json({
      success: true,
      data: {
        ...result,
        sugerencias,
        nEvidencias: ctx.nEvidencias,
        nAdjuntos: ctx.nAdjuntos,
      },
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      code: error.code || 'IA_ERROR',
      error: error.message,
      intentos: error.intentos || undefined,
      ayuda: AYUDA_KEYS,
    });
  }
});

export default router;
