import SecurUser from '../models/SecurUser.js';
import { normalizeEmailLocale } from '../services/emailI18n.js';

/**
 * Resuelve el locale de preferencia de un usuario SecurUser (login o email).
 * Fallback: 'es'.
 */
export async function resolveUserLocale({ login, email, locale } = {}) {
  if (locale === 'en' || locale === 'es') return locale;
  try {
    const query = [];
    if (login) query.push({ login: String(login).trim() });
    if (email) query.push({ email: String(email).trim().toLowerCase() });
    if (!query.length) return 'es';
    const user = await SecurUser.findOne({ $or: query }).select('locale').lean();
    return normalizeEmailLocale({ locale: user?.locale });
  } catch {
    return 'es';
  }
}

/** Adjunta `locale` a un payload de email según preferencia del destinatario principal. */
export async function withRecipientLocale(datos = {}, recipient = {}) {
  const locale = await resolveUserLocale({
    login: recipient.login || datos.codiRespnsble || datos.loginResponsable,
    email: recipient.email || datos.emailResponsable,
    locale: datos.locale,
  });
  return { ...datos, locale };
}
