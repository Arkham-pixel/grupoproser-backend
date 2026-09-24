/**
 * Proveedores LLM para Arnald IA.
 *
 * Por defecto SOLO free/freemium (Gemini + Groq): no cobra.
 * OpenAI / Together / OpenRouter quedan fuera salvo ARNALD_IA_ALLOW_PAID=1.
 */

function env(name) {
  return String(process.env[name] || '').trim();
}

function allowPaid() {
  return env('ARNALD_IA_ALLOW_PAID') === '1';
}

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data?.error?.code || data?.code || '';
    err.retryable =
      res.status === 429 ||
      res.status === 503 ||
      /quota|rate|limit|billing|credit|exhausted|insufficient/i.test(
        `${err.message} ${err.code}`
      );
    throw err;
  }
  return data;
}

function textoDesdeChoices(data) {
  return (
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ||
    ''
  );
}

/** Groq free tier — https://console.groq.com (sin cobro; hay límites diarios) */
export const groqProvider = {
  id: 'groq',
  name: 'Groq (gratis)',
  free: true,
  isConfigured: () => Boolean(env('GROQ_API_KEY')),
  async chat({ messages, model } = {}) {
    const data = await postJson(
      'https://api.groq.com/openai/v1/chat/completions',
      { Authorization: `Bearer ${env('GROQ_API_KEY')}` },
      {
        model: model || env('GROQ_MODEL') || 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.3,
      }
    );
    return { text: textoDesdeChoices(data), provider: 'groq', raw: data };
  },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Google Gemini free — https://aistudio.google.com/apikey (visión + PDF; sin cobro en free tier) */
export const geminiProvider = {
  id: 'gemini',
  name: 'Google Gemini (gratis)',
  free: true,
  isConfigured: () => Boolean(env('GEMINI_API_KEY') || env('GOOGLE_AI_API_KEY')),
  supportsVision: true,
  async chat({ messages, model, adjuntos = [] } = {}) {
    const key = env('GEMINI_API_KEY') || env('GOOGLE_AI_API_KEY');
    const modelos = [
      model,
      env('GEMINI_MODEL'),
      'gemini-3.6-flash',
      'gemini-flash-latest',
    ].filter((v, i, arr) => v && arr.indexOf(v) === i);

    const system = messages.filter((x) => x.role === 'system').map((x) => x.content).join('\n');
    const nonSystem = messages.filter((x) => x.role !== 'system');
    const contents = nonSystem.map((x, idx) => {
      const parts = [{ text: typeof x.content === 'string' ? x.content : JSON.stringify(x.content) }];
      if (
        idx === nonSystem.length - 1 &&
        x.role === 'user' &&
        Array.isArray(adjuntos) &&
        adjuntos.length
      ) {
        for (const a of adjuntos) {
          if (!a?.base64 || !a?.mime) continue;
          parts.push({
            inline_data: {
              mime_type: a.mime,
              data: a.base64,
            },
          });
        }
      }
      return {
        role: x.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });
    const body = {
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    };

    let lastErr = null;
    for (let pasada = 0; pasada < 2; pasada += 1) {
      for (let i = 0; i < modelos.length; i += 1) {
        const m = modelos[i];
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`;
        try {
          const data = await postJson(url, {}, body);
          const text = textoDesdeChoices(data);
          if (!text) {
            const err = new Error(data?.error?.message || 'Gemini sin respuesta');
            err.retryable = true;
            throw err;
          }
          return { text, provider: 'gemini', raw: data, model: m };
        } catch (err) {
          lastErr = err;
          const msg = String(err.message || '');
          const saltarModelo =
            err.status === 404 || /no longer available|not found|not supported/i.test(msg);
          const congestionado =
            err.retryable ||
            err.status === 503 ||
            err.status === 429 ||
            /high demand|unavailable|quota|rate|RESOURCE_EXHAUSTED/i.test(msg);
          if (saltarModelo) continue;
          if (!congestionado) throw err;
          await sleep(900 + pasada * 600);
        }
      }
    }
    throw lastErr || new Error('Gemini sin respuesta');
  },
};

/** OpenRouter — solo si se habilita pago explícitamente (puede cobrar). */
export const openRouterProvider = {
  id: 'openrouter',
  name: 'OpenRouter',
  free: false,
  isConfigured: () => allowPaid() && Boolean(env('OPENROUTER_API_KEY')),
  async chat({ messages, model } = {}) {
    const data = await postJson(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        Authorization: `Bearer ${env('OPENROUTER_API_KEY')}`,
        'HTTP-Referer': env('OPENROUTER_REFERER') || 'https://arnald.grupoproser.com.co',
        'X-Title': 'Arnald IA',
      },
      {
        model: model || env('OPENROUTER_MODEL') || 'meta-llama/llama-3.2-3b-instruct:free',
        messages,
      }
    );
    return { text: textoDesdeChoices(data), provider: 'openrouter', raw: data };
  },
};

/** Together AI — de pago; solo con ARNALD_IA_ALLOW_PAID=1 */
export const togetherProvider = {
  id: 'together',
  name: 'Together AI',
  free: false,
  isConfigured: () => allowPaid() && Boolean(env('TOGETHER_API_KEY')),
  async chat({ messages, model } = {}) {
    const data = await postJson(
      'https://api.together.xyz/v1/chat/completions',
      { Authorization: `Bearer ${env('TOGETHER_API_KEY')}` },
      {
        model: model || env('TOGETHER_MODEL') || 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
        messages,
      }
    );
    return { text: textoDesdeChoices(data), provider: 'together', raw: data };
  },
};

/** OpenAI — de pago; bloqueado salvo ARNALD_IA_ALLOW_PAID=1 y sin OPENAI_IA_DISABLED */
export const openaiProvider = {
  id: 'openai',
  name: 'OpenAI',
  free: false,
  isConfigured: () =>
    allowPaid() &&
    Boolean(env('OPENAI_API_KEY')) &&
    env('OPENAI_IA_DISABLED') !== '1',
  supportsVision: false,
  async chat({ messages, model } = {}) {
    const data = await postJson(
      'https://api.openai.com/v1/chat/completions',
      { Authorization: `Bearer ${env('OPENAI_API_KEY')}` },
      {
        model: model || env('OPENAI_MODEL') || 'gpt-4o-mini',
        messages,
        temperature: 0.3,
      }
    );
    return { text: textoDesdeChoices(data), provider: 'openai', raw: data };
  },
};

/** Free primero. De pago solo si ARNALD_IA_ALLOW_PAID=1. */
export const ALL_PROVIDERS = [
  geminiProvider,
  groqProvider,
  openRouterProvider,
  togetherProvider,
  openaiProvider,
];

const FREE_DEFAULT_IDS = ['gemini', 'groq'];

export function proveedoresOrdenados() {
  const byId = Object.fromEntries(ALL_PROVIDERS.map((p) => [p.id, p]));
  const raw = env('ARNALD_IA_PROVIDERS');
  const ids = raw
    ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : FREE_DEFAULT_IDS;

  return ids
    .map((id) => byId[id])
    .filter((p) => {
      if (!p || !p.isConfigured()) return false;
      if (!allowPaid() && p.free === false) return false;
      return true;
    });
}
