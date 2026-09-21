import { resolveVideoperitajePublicUrl } from '../config/platformUrls.js';
import { enviarInvitacionVideoperitaje } from './emailService.js';
import { enviarWhatsAppVideoperitaje } from './videoperitajeWhatsappService.js';

function soloDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

export function normalizarCelularWhatsApp(celular) {
  let digits = soloDigitos(celular);
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('3')) digits = `57${digits}`;
  if (digits.length === 12 && digits.startsWith('57')) return digits;
  if (digits.length >= 10) return digits;
  return '';
}

export function urlWhatsAppInvitacion(celular, texto) {
  const phone = normalizarCelularWhatsApp(celular);
  if (!phone) return '';
  return `https://wa.me/${phone}?text=${encodeURIComponent(texto)}`;
}

export function urlUnirseVideoperitaje(tokenRaw, frontendUrl) {
  const base = String(frontendUrl || resolveVideoperitajePublicUrl()).replace(/\/+$/, '');
  return `${base}/videoperitaje/unirse/${encodeURIComponent(tokenRaw)}`;
}

export async function notificarInvitacionSesion({
  sesion,
  tokenRaw,
  frontendUrl,
}) {
  const urlPublica = urlUnirseVideoperitaje(tokenRaw, frontendUrl || resolveVideoperitajePublicUrl());
  const tipoLabel = sesion.tipo === 'guided' ? 'autoinspección guiada' : 'videoperitaje';
  const textoWa = [
    `Grupo Proser — ${tipoLabel}`,
    sesion.expediente ? `Expediente: ${sesion.expediente}` : '',
    'Abra este enlace desde su celular (no necesita instalar ninguna app):',
    urlPublica,
  ]
    .filter(Boolean)
    .join('\n');

  const whatsappUrl = urlWhatsAppInvitacion(sesion.celular, textoWa);
  let emailEnviado = false;
  let emailError = '';
  let whatsappEnviado = false;
  let whatsappError = '';

  if (sesion.email) {
    const r = await enviarInvitacionVideoperitaje({
      emailDestino: sesion.email,
      nombreDestino: sesion.aseguradoNombre,
      expediente: sesion.expediente,
      tipo: sesion.tipo,
      urlPublica,
    });
    emailEnviado = Boolean(r?.success);
    emailError = r?.success ? '' : String(r?.message || '');
  }

  if (sesion.celular) {
    const wa = await enviarWhatsAppVideoperitaje({
      celular: sesion.celular,
      texto: textoWa,
      urlPublica,
    });
    whatsappEnviado = Boolean(wa?.ok);
    whatsappError = wa?.ok ? '' : String(wa?.error || '');
  }

  return {
    urlPublica,
    whatsappUrl,
    emailEnviado,
    emailError,
    whatsappEnviado,
    whatsappError,
  };
}
