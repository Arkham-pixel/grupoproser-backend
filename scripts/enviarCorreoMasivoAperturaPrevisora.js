/**
 * Envío masivo: correo de apertura GRUPO PROSER → asegurados
 * Seguros La Previsora (listado + inspección CAT, sin duplicar correo).
 *
 * Uso:
 *   node scripts/enviarCorreoMasivoAperturaPrevisora.js              # dry-run
 *   node scripts/enviarCorreoMasivoAperturaPrevisora.js --test=tu@correo.com
 *   node scripts/enviarCorreoMasivoAperturaPrevisora.js --apply
 *   node scripts/enviarCorreoMasivoAperturaPrevisora.js --apply --limit=10
 *   node scripts/enviarCorreoMasivoAperturaPrevisora.js --apply --only=correo@dominio.com
 *   node scripts/enviarCorreoMasivoAperturaPrevisora.js --apply --force
 *   node scripts/enviarCorreoMasivoAperturaPrevisora.js --apply --delay=1500
 *
 * Por defecto NO envía (solo lista destinatarios). Con --apply marca
 * fechaEmailAperturaPrevisora en cada caso vinculado al correo.
 */
import dns from 'dns';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import PrevisoraListadoCaso from '../models/PrevisoraListadoCaso.js';
import PrevisoraCaso from '../models/PrevisoraCaso.js';
import { deliverMail, isMailConfigured, getMailConfigStatus } from '../services/mailTransport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const ASSETS_EMAIL = path.join(__dirname, '..', 'assets', 'email');
const LOGO_PROSER = path.join(ASSETS_EMAIL, 'logo-grupoproser.png');
const LOGO_PREVISORA = path.join(ASSETS_EMAIL, 'logo-previsora.png');
const LOCK_PATH = path.join(__dirname, '.lock_apertura_previsora');

const CONTACTO_CORREO = 'yvitola@proserpuertos.com.co';
const CONTACTO_TELEFONO = '3165231821';

const ASUNTO = 'GRUPO PROSER — Atención de su reclamación Seguros La Previsora';

const CUERPO_TEXTO = `Estimado(a) asegurado(a):

Reciba un cordial saludo.

Le informamos que GRUPO PROSER ha sido designado por Seguros La Previsora para acompañar la atención y gestión técnica de su reclamación, relacionada con el evento reportado.

Su caso se encuentra en proceso de gestión y próximamente uno de nuestros profesionales se comunicará con usted para coordinar la inspección correspondiente.

Debido al número de reclamaciones generadas por el evento, nuestro equipo se encuentra trabajando para atender cada caso oportunamente. Agradecemos su comprensión durante este proceso.

Para agilizar la revisión, agradecemos tener disponibles, en caso de contar con ellos, los siguientes documentos:

1. Registro fotográfico de los daños.
2. Facturas o cotizaciones de reparación.
3. Certificado de tradición y libertad del inmueble.

Si desea adelantar información o documentos, puede escribir o comunicarse con:

Correo electrónico: ${CONTACTO_CORREO}
Teléfono: ${CONTACTO_TELEFONO}

No es necesario responder este correo.

Agradecemos su colaboración y reiteramos nuestro compromiso de acompañarlo durante la gestión de su reclamación.

Cordialmente,

GRUPO PROSER
Ajustadores designados por Seguros La Previsora.
`;

function adjuntosLogos() {
  const attachments = [];
  if (fs.existsSync(LOGO_PROSER)) {
    attachments.push({
      filename: 'logo-grupoproser.png',
      path: LOGO_PROSER,
      cid: 'logoProser',
      contentDisposition: 'inline',
    });
  }
  if (fs.existsSync(LOGO_PREVISORA)) {
    attachments.push({
      filename: 'logo-previsora.png',
      path: LOGO_PREVISORA,
      cid: 'logoPrevisora',
      contentDisposition: 'inline',
    });
  }
  return attachments;
}

function cuerpoHtml() {
  const tieneProser = fs.existsSync(LOGO_PROSER);
  const tienePrev = fs.existsSync(LOGO_PREVISORA);
  const celdaProser = tieneProser
    ? `<img src="cid:logoProser" alt="GRUPO PROSER" width="170" height="52" style="display:block;max-width:170px;height:auto;border:0;" />`
    : `<span style="color:#0f172a;font-size:15px;font-weight:bold;">GRUPO PROSER</span>`;
  const celdaPrev = tienePrev
    ? `<img src="cid:logoPrevisora" alt="Seguros La Previsora" width="150" height="48" style="display:block;max-width:150px;height:auto;border:0;margin-left:auto;" />`
    : `<span style="color:#1e3a5f;font-size:15px;font-weight:bold;">Seguros La Previsora</span>`;

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="background:#ffffff;padding:18px 24px;border-bottom:1px solid #e5e7eb;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="left" valign="middle" width="50%">${celdaProser}</td>
                  <td align="right" valign="middle" width="50%">${celdaPrev}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#1e3a5f;color:#ffffff;padding:12px 28px;font-size:13px;font-weight:bold;letter-spacing:0.02em;">
              Atención de reclamación · Seguros La Previsora
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-size:14px;line-height:1.55;color:#1f2937;">
              <p style="margin:0 0 14px;">Estimado(a) asegurado(a):</p>
              <p style="margin:0 0 14px;">Reciba un cordial saludo.</p>
              <p style="margin:0 0 14px;">
                Le informamos que <strong>GRUPO PROSER</strong> ha sido designado por
                <strong>Seguros La Previsora</strong> para acompañar la atención y gestión técnica de su
                reclamación, relacionada con el evento reportado.
              </p>
              <p style="margin:0 0 14px;">
                Su caso se encuentra en proceso de gestión y próximamente uno de nuestros
                profesionales se comunicará con usted para coordinar la inspección correspondiente.
              </p>
              <p style="margin:0 0 14px;">
                Debido al número de reclamaciones generadas por el evento, nuestro equipo se
                encuentra trabajando para atender cada caso oportunamente. Agradecemos su
                comprensión durante este proceso.
              </p>
              <p style="margin:0 0 10px;">
                Para agilizar la revisión, agradecemos tener disponibles, en caso de contar con ellos,
                los siguientes documentos:
              </p>
              <ol style="margin:0 0 16px;padding-left:20px;">
                <li>Registro fotográfico de los daños.</li>
                <li>Facturas o cotizaciones de reparación.</li>
                <li>Certificado de tradición y libertad del inmueble.</li>
              </ol>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;">
                <tr>
                  <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:14px 16px;">
                    <p style="margin:0 0 8px;font-size:13px;color:#1e3a8a;font-weight:bold;">
                      Contacto para adelantar información o documentos
                    </p>
                    <p style="margin:0;font-size:14px;color:#1f2937;">
                      Correo electrónico:
                      <a href="mailto:${CONTACTO_CORREO}" style="color:#1d4ed8;text-decoration:none;">${CONTACTO_CORREO}</a><br />
                      Teléfono: ${CONTACTO_TELEFONO}
                    </p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 14px;"><em>No es necesario responder este correo.</em></p>
              <p style="margin:0 0 18px;">
                Agradecemos su colaboración y reiteramos nuestro compromiso de acompañarlo durante
                la gestión de su reclamación.
              </p>
              <p style="margin:0;">
                Cordialmente,<br /><br />
                <strong>GRUPO PROSER</strong><br />
                Ajustadores designados por Seguros La Previsora
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function limpiarEmail(rawEmail) {
  let email = String(rawEmail || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  let local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const phonePrefix = local.match(/^(\d{7,12}|0)-(.+)$/);
  if (phonePrefix && /[a-z]/i.test(phonePrefix[2])) {
    local = phonePrefix[2];
  }
  email = `${local}@${domain}`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (email.endsWith('.con') || email.endsWith('gmailcom') || email.endsWith('hotmailcom')) {
    return null;
  }
  if (/sininformacion|noemail|noreply|sincorreo/.test(email)) return null;
  return email;
}

function extraerEmails(raw) {
  const text = String(raw || '');
  const found = text.match(EMAIL_RE) || [];
  const out = [];
  const seen = new Set();
  for (const e of found) {
    const email = limpiarEmail(e);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function emailsDeCaso(c) {
  const fromAseg = extraerEmails(
    [c.correoAsegurado, c.contactoAsegurado, c.correo, c.informacionContacto]
      .filter(Boolean)
      .join(' ')
  );
  if (fromAseg.length) return { emails: fromAseg, via: 'asegurado' };
  const fromInt = extraerEmails(
    [c.correoIntermediario, c.contactoIntermediario].filter(Boolean).join(' ')
  );
  if (fromInt.length) return { emails: fromInt, via: 'intermediario' };
  return { emails: [], via: null };
}

function parseArgs(argv) {
  const out = {
    apply: false,
    force: false,
    limit: null,
    delay: 1500,
    test: null,
    only: null,
  };
  for (const a of argv) {
    if (a === '--apply') out.apply = true;
    else if (a === '--force') out.force = true;
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8)) || null;
    else if (a.startsWith('--delay=')) out.delay = Math.max(200, Number(a.slice(8)) || 1500);
    else if (a.startsWith('--test=')) out.test = String(a.slice(7)).trim().toLowerCase() || null;
    else if (a.startsWith('--only=')) out.only = String(a.slice(7)).trim().toLowerCase() || null;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function adquirirLock() {
  if (fs.existsSync(LOCK_PATH)) {
    const prev = fs.readFileSync(LOCK_PATH, 'utf8').trim();
    throw new Error(`Ya hay un envío Previsora en curso (lock: ${prev}). Espere o borre ${LOCK_PATH}`);
  }
  fs.writeFileSync(LOCK_PATH, `${process.pid} ${new Date().toISOString()}`);
}

function soltarLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
  } catch {
    /* ignore */
  }
}

function nombreAsegurado(c) {
  return c.asegurado || c.tomador || '';
}

function refSiniestro(c) {
  return c.noCaso || c.zc || c.siniestro || c.consecutivo || '';
}

function acumularCasos(casos, origen, byEmail) {
  let sinCorreo = 0;
  let viaIntermediario = 0;
  for (const c of casos) {
    const { emails, via } = emailsDeCaso(c);
    if (!emails.length) {
      sinCorreo += 1;
      continue;
    }
    if (via === 'intermediario') viaIntermediario += 1;
    for (const email of emails) {
      if (!byEmail.has(email)) {
        byEmail.set(email, {
          email,
          refs: [],
          yaEnviado: false,
          asegurado: nombreAsegurado(c),
          siniestro: refSiniestro(c),
          via,
        });
      }
      const row = byEmail.get(email);
      row.refs.push({ id: String(c._id), origen });
      if (c.fechaEmailAperturaPrevisora) row.yaEnviado = true;
      if (!row.asegurado) row.asegurado = nombreAsegurado(c);
      if (!row.siniestro) row.siniestro = refSiniestro(c);
    }
  }
  return { sinCorreo, viaIntermediario };
}

async function marcarEnviados(refs, messageId) {
  const listadoIds = refs.filter((r) => r.origen === 'listado').map((r) => r.id);
  const catIds = refs.filter((r) => r.origen === 'cat').map((r) => r.id);
  const patch = {
    $set: {
      fechaEmailAperturaPrevisora: new Date(),
      emailAperturaPrevisoraMessageId: messageId,
    },
  };
  if (listadoIds.length) {
    await PrevisoraListadoCaso.updateMany({ _id: { $in: listadoIds } }, patch);
  }
  if (catIds.length) {
    await PrevisoraCaso.updateMany({ _id: { $in: catIds } }, patch);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('Falta MONGO_URI');
    process.exit(1);
  }

  console.log('Mail config:', getMailConfigStatus());
  if ((args.apply || args.test) && !isMailConfigured()) {
    console.error('EMAIL_USER / EMAIL_PASS no configurados.');
    process.exit(1);
  }

  if (args.apply) adquirirLock();

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });

    const select =
      '_id correoAsegurado contactoAsegurado correoIntermediario contactoIntermediario correo informacionContacto asegurado tomador siniestro zc noCaso consecutivo fechaEmailAperturaPrevisora';

    const [casosListado, casosCat] = await Promise.all([
      PrevisoraListadoCaso.find({}).select(select).lean(),
      PrevisoraCaso.find({}).select(select).lean(),
    ]);

    /** @type {Map<string, { email: string, refs: {id:string,origen:string}[], yaEnviado: boolean, asegurado: string, siniestro: string, via: string }>} */
    const byEmail = new Map();
    const rListado = acumularCasos(casosListado, 'listado', byEmail);
    const rCat = acumularCasos(casosCat, 'cat', byEmail);

    let destinatarios = [...byEmail.values()];
    if (args.only) {
      destinatarios = destinatarios.filter((d) => d.email === args.only);
    }
    if (!args.force) {
      destinatarios = destinatarios.filter((d) => !d.yaEnviado);
    }
    if (args.limit != null && args.limit > 0) {
      destinatarios = destinatarios.slice(0, args.limit);
    }

    console.log(
      JSON.stringify(
        {
          casosListado: casosListado.length,
          casosCat: casosCat.length,
          sinCorreoListado: rListado.sinCorreo,
          sinCorreoCat: rCat.sinCorreo,
          viaIntermediario: rListado.viaIntermediario + rCat.viaIntermediario,
          correosUnicosEnBd: byEmail.size,
          yaEnviadosOmitidos: args.force
            ? 0
            : [...byEmail.values()].filter((d) => d.yaEnviado).length,
          aEnviar: destinatarios.length,
          modo: args.test ? `TEST → ${args.test}` : args.apply ? 'APPLY' : 'DRY-RUN',
          delayMs: args.delay,
          only: args.only,
          replyTo: CONTACTO_CORREO,
        },
        null,
        2
      )
    );

    if (args.test) {
      console.log(`Enviando prueba a ${args.test}…`);
      const logos = adjuntosLogos();
      console.log(`Logos adjuntos: ${logos.map((a) => a.filename).join(', ') || 'NINGUNO'}`);
      const info = await deliverMail(
        {
          to: args.test,
          replyTo: CONTACTO_CORREO,
          subject: `[PRUEBA] ${ASUNTO}`,
          text: CUERPO_TEXTO,
          html: cuerpoHtml(),
          attachments: logos,
        },
        { enqueue: false, tipo: 'previsora-apertura-test' }
      );
      console.log('OK prueba messageId:', info?.messageId || info);
      await mongoose.disconnect();
      return;
    }

    if (!args.apply) {
      console.log('\nDry-run. Para enviar de verdad:');
      console.log('  node scripts/enviarCorreoMasivoAperturaPrevisora.js --apply');
      console.log('  node scripts/enviarCorreoMasivoAperturaPrevisora.js --test=tu@correo.com');
      const previewPath = path.join(__dirname, `_preview_apertura_previsora_${Date.now()}.json`);
      fs.writeFileSync(
        previewPath,
        JSON.stringify(
          destinatarios.map((d) => ({
            email: d.email,
            asegurado: d.asegurado,
            siniestro: d.siniestro,
            via: d.via,
            casos: d.refs.length,
          })),
          null,
          2
        )
      );
      console.log('Lista preview:', previewPath);
      await mongoose.disconnect();
      return;
    }

    const log = {
      startedAt: new Date().toISOString(),
      ok: [],
      fail: [],
    };

    const logos = adjuntosLogos();
    console.log(`Logos adjuntos: ${logos.map((a) => a.filename).join(', ') || 'NINGUNO'}`);

    for (let i = 0; i < destinatarios.length; i++) {
      const d = destinatarios[i];
      const n = i + 1;
      try {
        const info = await deliverMail(
          {
            to: d.email,
            replyTo: CONTACTO_CORREO,
            subject: ASUNTO,
            text: CUERPO_TEXTO,
            html: cuerpoHtml(),
            attachments: logos,
          },
          { enqueue: false, tipo: 'previsora-apertura' }
        );
        const messageId = info?.messageId || '';
        await marcarEnviados(d.refs, messageId);
        log.ok.push({ email: d.email, messageId, casos: d.refs.length, via: d.via });
        console.log(`[${n}/${destinatarios.length}] OK ${d.email}`);
      } catch (err) {
        log.fail.push({ email: d.email, error: err?.message || String(err) });
        console.error(`[${n}/${destinatarios.length}] FAIL ${d.email}:`, err?.message || err);
      }
      if (i < destinatarios.length - 1) await sleep(args.delay);
    }

    log.finishedAt = new Date().toISOString();
    log.summary = { ok: log.ok.length, fail: log.fail.length };
    const logPath = path.join(__dirname, `_log_apertura_previsora_${Date.now()}.json`);
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
    console.log('\nResumen:', log.summary);
    console.log('Log:', logPath);

    await mongoose.disconnect();
    if (log.fail.length) process.exitCode = 2;
  } finally {
    if (args.apply) soltarLock();
  }
}

const esEjecucionDirecta = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
})();

if (esEjecucionDirecta) {
  main().catch((err) => {
    soltarLock();
    console.error(err);
    process.exit(1);
  });
}
