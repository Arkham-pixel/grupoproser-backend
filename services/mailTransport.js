import nodemailer from 'nodemailer';

const VERIFY_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1500;

let cachedTransporter = null;
let lastVerifyAt = 0;
let lastVerifyOk = false;
let lastStartupCheck = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isMailConfigured() {
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASS?.trim();
  const host = process.env.SMTP_HOST?.trim();
  if (!user || !pass) return false;
  if (host) return true;
  return true;
}

export function getMailConfigStatus() {
  const user = process.env.EMAIL_USER?.trim() || '';
  const maskedUser = user.includes('@')
    ? `${user.slice(0, 2)}***@${user.split('@')[1]}`
    : user ? '***' : null;

  return {
    configured: isMailConfigured(),
    user: maskedUser,
    mode: process.env.SMTP_HOST?.trim() ? 'smtp' : (process.env.EMAIL_SERVICE || 'gmail'),
    smtpHost: process.env.SMTP_HOST?.trim() || null,
    from: process.env.EMAIL_FROM?.trim() || user || null,
    lastStartupCheck,
    lastVerifyOk,
    lastVerifyAt: lastVerifyAt ? new Date(lastVerifyAt).toISOString() : null,
  };
}

function buildTransportOptions() {
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASS?.trim();
  const host = process.env.SMTP_HOST?.trim();

  if (!user || !pass) {
    throw new Error(
      'Correo no configurado en el servidor. Defina EMAIL_USER y EMAIL_PASS en backend/.env y reinicie PM2.'
    );
  }

  if (host) {
    const port = Number(process.env.SMTP_PORT) || 587;
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    return {
      host,
      port,
      secure,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
      },
    };
  }

  return {
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: { user, pass },
  };
}

export function createTransporter() {
  return nodemailer.createTransport(buildTransportOptions());
}

function resetTransporterCache() {
  cachedTransporter = null;
  lastVerifyOk = false;
  lastVerifyAt = 0;
}

export function isAuthError(error) {
  const message = (error?.message || '').toLowerCase();
  const code = error?.responseCode;
  return (
    code === 535 ||
    code === 534 ||
    message.includes('invalid login') ||
    message.includes('username and password not accepted') ||
    message.includes('authentication failed') ||
    message.includes('badcredentials')
  );
}

function isTransientError(error) {
  if (isAuthError(error)) return false;
  const transientCodes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNECTION', 'ESOCKET', 'ETIMEOUT', 'EAI_AGAIN'];
  if (transientCodes.includes(error?.code)) return true;
  const responseCode = error?.responseCode;
  return typeof responseCode === 'number' && responseCode >= 421 && responseCode < 500;
}

async function ensureVerified(transporter) {
  const now = Date.now();
  if (lastVerifyOk && now - lastVerifyAt < VERIFY_TTL_MS) {
    return;
  }
  await transporter.verify();
  lastVerifyAt = now;
  lastVerifyOk = true;
}

function defaultFrom() {
  const fromName = process.env.EMAIL_FROM_NAME?.trim() || 'Grupo Proser';
  const fromAddress = process.env.EMAIL_FROM?.trim() || process.env.EMAIL_USER?.trim();
  return `"${fromName}" <${fromAddress}>`;
}

function friendlyMailError(error) {
  if (isAuthError(error)) {
    return new Error(
      'No se pudo autenticar con el servidor de correo (credenciales inválidas o contraseña de aplicación revocada). Revise EMAIL_USER y EMAIL_PASS en backend/.env del servidor de producción.'
    );
  }
  return error;
}

/**
 * Envía correo con reintentos en fallos transitorios.
 * Si falla y meta.enqueue !== false, encola en MongoDB para reintento automático.
 */
export async function deliverMail(mailOptions, meta = {}) {
  if (!isMailConfigured()) {
    throw new Error('Correo no configurado: EMAIL_USER y EMAIL_PASS son obligatorios.');
  }

  const options = {
    ...mailOptions,
    from: mailOptions.from || defaultFrom(),
  };

  const maxAttempts = Number(process.env.EMAIL_RETRY_ATTEMPTS) || DEFAULT_RETRY_ATTEMPTS;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (!cachedTransporter) {
        cachedTransporter = createTransporter();
        lastVerifyOk = false;
      }
      await ensureVerified(cachedTransporter);
      const info = await cachedTransporter.sendMail(options);
      return info;
    } catch (error) {
      lastError = error;
      resetTransporterCache();

      if (isAuthError(error)) break;
      if (!isTransientError(error) || attempt >= maxAttempts) break;

      const delayMs = RETRY_BASE_MS * 2 ** (attempt - 1);
      console.warn(
        `⚠️ Correo falló (intento ${attempt}/${maxAttempts}), reintento en ${delayMs}ms:`,
        error.message
      );
      await sleep(delayMs);
    }
  }

  if (meta.enqueue !== false) {
    try {
      const { enqueueOutgoingMail } = await import('./emailOutboxService.js');
      await enqueueOutgoingMail(options, meta, lastError);
      console.warn('📥 Correo encolado para reintento automático:', meta.tipo || meta.source || 'sin-tipo');
    } catch (queueError) {
      console.error('❌ No se pudo encolar el correo:', queueError.message);
    }
  }

  throw friendlyMailError(lastError);
}

export async function verifyMailOnStartup() {
  const status = {
    ok: false,
    at: new Date().toISOString(),
    error: null,
    ...getMailConfigStatus(),
  };

  if (!isMailConfigured()) {
    status.error = 'EMAIL_USER o EMAIL_PASS no definidos';
    lastStartupCheck = status;
    console.error('❌ [correo] Servidor sin credenciales SMTP — las alertas por email NO funcionarán.');
    return status;
  }

  try {
    resetTransporterCache();
    cachedTransporter = createTransporter();
    await ensureVerified(cachedTransporter);
    status.ok = true;
    console.log('✅ [correo] SMTP verificado al arrancar — alertas por email habilitadas.');
  } catch (error) {
    status.error = isAuthError(error)
      ? 'Credenciales SMTP rechazadas por el proveedor (revise contraseña de aplicación en .env)'
      : error.message;
    console.error('❌ [correo] Falló verificación SMTP al arrancar:', status.error);
    console.error('   Las notificaciones fallarán hasta corregir backend/.env y ejecutar: pm2 restart grupo-proser-backend');
  }

  lastStartupCheck = status;
  return status;
}
