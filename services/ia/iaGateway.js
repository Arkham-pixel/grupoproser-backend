/**
 * Gateway Arnald IA: elige entre varias IAs gratuitas/freemium.
 * Si una falla por cuota o rate-limit, prueba la siguiente.
 *
 * NO se usa en producción hasta ARNALD_IA_ENABLED=true.
 */
import { arnaldIaHabilitado } from '../../config/arnaldFeatures.js';
import { proveedoresOrdenados } from './providers.js';

let lastOkProviderId = '';

export function estadoGatewayIa() {
  const list = proveedoresOrdenados();
  const providers = list.map((p) => ({
    id: p.id,
    name: p.name,
    free: p.free !== false,
  }));
  return {
    enabled: arnaldIaHabilitado(),
    freeOnly: process.env.ARNALD_IA_ALLOW_PAID !== '1',
    providers,
    lastOkProviderId: lastOkProviderId || null,
  };
}

/**
 * @param {{ messages: Array<{role:string, content:string}>, preferredProvider?: string, model?: string, adjuntos?: Array, requireVision?: boolean }} opts
 */
export async function chatConRotacion(opts = {}) {
  if (!arnaldIaHabilitado()) {
    const err = new Error('Arnald IA está deshabilitada (ARNALD_IA_ENABLED≠true)');
    err.status = 503;
    err.code = 'IA_DISABLED';
    throw err;
  }

  const messages = Array.isArray(opts.messages) ? opts.messages : [];
  if (!messages.length) {
    const err = new Error('messages vacío');
    err.status = 400;
    throw err;
  }

  const adjuntos = Array.isArray(opts.adjuntos) ? opts.adjuntos : [];
  const needVision = Boolean(opts.requireVision || adjuntos.length);

  let list = proveedoresOrdenados();
  if (needVision) {
    // Preferir proveedores con visión (Gemini); los demás se intentan sin adjuntos al final
    list = [...list].sort((a, b) => {
      const av = a.supportsVision ? 0 : 1;
      const bv = b.supportsVision ? 0 : 1;
      return av - bv;
    });
  }
  if (opts.preferredProvider) {
    const pref = String(opts.preferredProvider).toLowerCase();
    list = [...list].sort((a, b) => (a.id === pref ? -1 : b.id === pref ? 1 : 0));
  }
  if (lastOkProviderId) {
    list = [...list].sort((a, b) => (a.id === lastOkProviderId ? -1 : b.id === lastOkProviderId ? 1 : 0));
  }

  if (!list.length) {
    const err = new Error(
      'Ningún proveedor IA gratis configurado. Defina GEMINI_API_KEY y/o GROQ_API_KEY (sin costo). OpenAI está desactivado.'
    );
    err.status = 503;
    err.code = 'IA_NO_PROVIDERS';
    throw err;
  }

  const intentos = [];
  for (const provider of list) {
    try {
      const payloadAdjuntos = provider.supportsVision ? adjuntos : [];
      const result = await provider.chat({
        messages,
        model: opts.model,
        adjuntos: payloadAdjuntos,
      });
      lastOkProviderId = provider.id;
      return {
        ok: true,
        text: result.text,
        provider: provider.id,
        providerName: provider.name,
        intentos,
        adjuntosUsados: payloadAdjuntos.length,
      };
    } catch (err) {
      intentos.push({
        provider: provider.id,
        error: err.message,
        retryable: Boolean(err.retryable),
        status: err.status || 0,
      });
      if (!err.retryable && err.status && err.status < 500 && err.status !== 429) {
        if (err.status === 400 || err.status === 401) continue;
      }
    }
  }

  const err = new Error('Todos los proveedores IA fallaron o agotaron cuota');
  err.status = 503;
  err.code = 'IA_ALL_FAILED';
  err.intentos = intentos;
  throw err;
}
