/**
 * Envío real de WhatsApp (Cloud API de Meta).
 * wa.me no entrega el mensaje: solo abre el chat del perito.
 *
 * .env:
 *   WHATSAPP_TOKEN=
 *   WHATSAPP_PHONE_NUMBER_ID=
 *   WHATSAPP_TEMPLATE_NAME=   (opcional; si existe se usa plantilla)
 *   WHATSAPP_TEMPLATE_LANG=es
 */

/**
 * Envío real de WhatsApp (Cloud API de Meta).
 * wa.me no entrega el mensaje: solo abre el chat del perito.
 *
 * .env:
 *   WHATSAPP_TOKEN=
 *   WHATSAPP_PHONE_NUMBER_ID=
 *   WHATSAPP_TEMPLATE_NAME=   (opcional; si existe se usa plantilla)
 *   WHATSAPP_TEMPLATE_LANG=es
 */

function soloDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function normalizarCelularWhatsApp(celular) {
  let digits = soloDigitos(celular);
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('3')) digits = `57${digits}`;
  if (digits.length === 12 && digits.startsWith('57')) return digits;
  if (digits.length >= 10) return digits;
  return '';
}

export function whatsappCloudConfigurado() {
  return Boolean(
    String(process.env.WHATSAPP_TOKEN || '').trim() &&
      String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim()
  );
}

export async function enviarWhatsAppVideoperitaje({ celular, texto, urlPublica }) {
  const phone = normalizarCelularWhatsApp(celular);
  if (!phone) {
    return { ok: false, error: 'Celular inválido para WhatsApp' };
  }
  const token = String(process.env.WHATSAPP_TOKEN || '').trim();
  const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (!token || !phoneId) {
    return {
      ok: false,
      error:
        'WhatsApp automático no está configurado (WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID). Sin la API de Meta el mensaje no llega solo.',
    };
  }

  const template = String(process.env.WHATSAPP_TEMPLATE_NAME || '').trim();
  const lang = String(process.env.WHATSAPP_TEMPLATE_LANG || 'es').trim();
  const payload = template
    ? {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: template,
          language: { code: lang },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: String(texto || 'Videoperitaje Grupo Proser').slice(0, 1024) },
                { type: 'text', text: String(urlPublica || '').slice(0, 1024) },
              ],
            },
          ],
        },
      }
    : {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { preview_url: true, body: String(texto || '').slice(0, 4096) },
      };

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.error?.error_user_msg ||
      `WhatsApp Cloud API HTTP ${res.status}`;
    return { ok: false, error: msg, status: res.status };
  }
  return { ok: true, id: data?.messages?.[0]?.id || '' };
}
