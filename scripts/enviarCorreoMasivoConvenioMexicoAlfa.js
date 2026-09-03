/**
 * Envío masivo Alfa: convenio de apoyo con firma ajustadora de México.
 * Solo casos operativos en estado "Sin contactar".
 *
 * Uso:
 *   node scripts/enviarCorreoMasivoConvenioMexicoAlfa.js
 *   node scripts/enviarCorreoMasivoConvenioMexicoAlfa.js --test=tu@correo.com
 *   node scripts/enviarCorreoMasivoConvenioMexicoAlfa.js --apply
 *   node scripts/enviarCorreoMasivoConvenioMexicoAlfa.js --apply --limit=10
 *   node scripts/enviarCorreoMasivoConvenioMexicoAlfa.js --apply --force
 *   node scripts/enviarCorreoMasivoConvenioMexicoAlfa.js --apply --delay=1500
 */
import dns from 'dns';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { homologarEstadoAlfa } from '../config/alfaExcelStatuses.js';
import { deliverMail, isMailConfigured, getMailConfigStatus } from '../services/mailTransport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const ASSETS_EMAIL = path.join(__dirname, '..', 'assets', 'email');
const LOGO_PROSER = path.join(ASSETS_EMAIL, 'logo-grupoproser.png');
const LOGO_ALFA = path.join(ASSETS_EMAIL, 'logo-seguros-alfa.png');
const LOCK_PATH = path.join(__dirname, '.lock_convenio_mexico_alfa');

const ASUNTO =
  'PROSER Ajustes — Convenio de apoyo para la atención de su reclamación Seguros Alfa';

const CUERPO_TEXTO = `Estimado(a) asegurado(a):

Reciba un cordial saludo.

Debido al alto volumen de reclamaciones recibidas con ocasión del evento ocurrido, PROSER Ajustes ha establecido un convenio de apoyo con una firma ajustadora especializada de la ciudad de México, con amplia experiencia en la atención y liquidación de siniestros.

Este equipo nos estará apoyando en diferentes etapas del proceso, con el objetivo de agilizar la atención, reducir los tiempos de espera y avanzar oportunamente en la gestión de las reclamaciones.

Es importante tener en cuenta:

- Si usted ya fue contactado por un ingeniero o arquitecto de PROSER, continuará siendo atendido por el profesional que le fue asignado.

- Es posible que, durante el proceso, reciba alguna llamada o comunicación proveniente de México. Este contacto hace parte de nuestro equipo de apoyo y se encuentra vinculado al proceso de atención de su reclamación.

- La revisión y análisis de los daños continuarán bajo los procedimientos y criterios técnicos establecidos por PROSER y la compañía aseguradora.

- Esta alianza busca fortalecer nuestra capacidad de respuesta y permitirnos atender de manera más rápida y organizada el elevado número de reclamaciones recibidas.

Agradecemos su comprensión, confianza y colaboración durante este proceso.

PROSER Ajustes
Equipo de Atención de Siniestros
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
  if (fs.existsSync(LOGO_ALFA)) {
    attachments.push({
      filename: 'logo-seguros-alfa.png',
      path: LOGO_ALFA,
      cid: 'logoAlfa',
      contentDisposition: 'inline',
    });
  }
  return attachments;
}

function cuerpoHtml() {
  const tieneProser = fs.existsSync(LOGO_PROSER);
  const tieneAlfa = fs.existsSync(LOGO_ALFA);
  const celdaProser = tieneProser
    ? `<img src="cid:logoProser" alt="PROSER Ajustes" width="150" height="48" style="display:block;max-width:150px;height:auto;border:0;" />`
    : `<span style="color:#0f172a;font-size:15px;font-weight:bold;">PROSER Ajustes</span>`;
  const celdaAlfa = tieneAlfa
    ? `<img src="cid:logoAlfa" alt="Seguros Alfa" width="140" height="62" style="display:block;max-width:140px;height:auto;border:0;margin-left:auto;" />`
    : `<span style="color:#0f172a;font-size:15px;font-weight:bold;">Seguros Alfa</span>`;

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
                  <td align="right" valign="middle" width="50%">${celdaAlfa}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#0f172a;color:#ffffff;padding:12px 28px;font-size:13px;font-weight:bold;letter-spacing:0.02em;">
              Convenio de apoyo · Atención de reclamaciones Seguros Alfa
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-size:14px;line-height:1.55;color:#1f2937;">
              <p style="margin:0 0 14px;">Estimado(a) asegurado(a):</p>
              <p style="margin:0 0 14px;">Reciba un cordial saludo.</p>
              <p style="margin:0 0 14px;">
                Debido al alto volumen de reclamaciones recibidas con ocasión del evento ocurrido,
                <strong>PROSER Ajustes</strong> ha establecido un convenio de apoyo con una firma
                ajustadora especializada de la ciudad de México, con amplia experiencia en la
                atención y liquidación de siniestros.
              </p>
              <p style="margin:0 0 16px;">
                Este equipo nos estará apoyando en diferentes etapas del proceso, con el objetivo de
                agilizar la atención, reducir los tiempos de espera y avanzar oportunamente en la
                gestión de las reclamaciones.
              </p>
              <p style="margin:0 0 10px;font-weight:bold;color:#0f172a;">Es importante tener en cuenta:</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;">
                <tr>
                  <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px;">
                    <p style="margin:0 0 10px;">
                      <strong>Si usted ya fue contactado</strong> por un ingeniero o arquitecto de PROSER,
                      continuará siendo atendido por el profesional que le fue asignado.
                    </p>
                    <p style="margin:0 0 10px;">
                      Es posible que, durante el proceso, reciba alguna llamada o comunicación
                      <strong>proveniente de México</strong>. Este contacto hace parte de nuestro equipo
                      de apoyo y se encuentra vinculado al proceso de atención de su reclamación.
                    </p>
                    <p style="margin:0 0 10px;">
                      La revisión y análisis de los daños continuarán bajo los procedimientos y
                      criterios técnicos establecidos por PROSER y la compañía aseguradora.
                    </p>
                    <p style="margin:0;">
                      Esta alianza busca fortalecer nuestra capacidad de respuesta y permitirnos
                      atender de manera más rápida y organizada el elevado número de reclamaciones
                      recibidas.
                    </p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 18px;">
                Agradecemos su comprensión, confianza y colaboración durante este proceso.
              </p>
              <p style="margin:0;">
                <strong>PROSER Ajustes</strong><br />
                Equipo de Atención de Siniestros
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
  if (phonePrefix && /[a-z]/i.test(phonePrefix[2])) local = phonePrefix[2];
  email = `${local}@${domain}`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (email.endsWith('.con') || email.endsWith('gmailcom') || email.endsWith('hotmailcom')) {
    return null;
  }
  if (/sininformacion|noemail|noreply|sincorreo/.test(email)) return null;
  return email;
}

function extraerEmails(raw) {
  const found = String(raw || '').match(EMAIL_RE) || [];
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

function parseArgs(argv) {
  const out = {
    apply: false,
    force: false,
    limit: null,
    delay: 1500,
    test: null,
  };
  for (const a of argv) {
    if (a === '--apply') out.apply = true;
    else if (a === '--force') out.force = true;
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8)) || null;
    else if (a.startsWith('--delay=')) out.delay = Math.max(300, Number(a.slice(8)) || 1500);
    else if (a.startsWith('--test=')) out.test = String(a.slice(7)).trim().toLowerCase() || null;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function adquirirLock() {
  if (fs.existsSync(LOCK_PATH)) {
    const prev = fs.readFileSync(LOCK_PATH, 'utf8').trim();
    throw new Error(`Ya hay un envío Alfa (México) en curso (lock: ${prev}).`);
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
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });

    const casos = await SegurosAlfaCaso.find({
      $or: [{ excluidoBaseAlfa: { $exists: false } }, { excluidoBaseAlfa: false }],
    })
      .select(
        '_id correo informacionContacto asegurado tomador siniestro estado estadoGestion fechaInspeccion fechaEmailConvenioMexico'
      )
      .lean();

    const sinContactar = casos.filter(
      (c) => homologarEstadoAlfa(c.estado, c) === 'Sin contactar'
    );

    const byEmail = new Map();
    let sinCorreo = 0;

    for (const c of sinContactar) {
      const emails = extraerEmails([c.correo, c.informacionContacto].filter(Boolean).join(' '));
      if (!emails.length) {
        sinCorreo += 1;
        continue;
      }
      for (const email of emails) {
        if (!byEmail.has(email)) {
          byEmail.set(email, {
            email,
            casoIds: [],
            yaEnviado: false,
            asegurado: c.asegurado || c.tomador || '',
            siniestro: c.siniestro || '',
          });
        }
        const row = byEmail.get(email);
        row.casoIds.push(String(c._id));
        if (c.fechaEmailConvenioMexico) row.yaEnviado = true;
        if (!row.asegurado) row.asegurado = c.asegurado || c.tomador || '';
        if (!row.siniestro) row.siniestro = c.siniestro || '';
      }
    }

    let destinatarios = [...byEmail.values()];
    if (!args.force) destinatarios = destinatarios.filter((d) => !d.yaEnviado);
    if (args.limit != null && args.limit > 0) destinatarios = destinatarios.slice(0, args.limit);

    console.log(
      JSON.stringify(
        {
          casosOperativos: casos.length,
          casosSinContactar: sinContactar.length,
          sinCorreoUtil: sinCorreo,
          correosUnicos: byEmail.size,
          yaEnviadosOmitidos: args.force
            ? 0
            : [...byEmail.values()].filter((d) => d.yaEnviado).length,
          aEnviar: destinatarios.length,
          modo: args.test ? `TEST → ${args.test}` : args.apply ? 'APPLY' : 'DRY-RUN',
          delayMs: args.delay,
        },
        null,
        2
      )
    );

    if (args.test) {
      const logos = adjuntosLogos();
      const info = await deliverMail(
        {
          to: args.test,
          subject: `[PRUEBA] ${ASUNTO}`,
          text: CUERPO_TEXTO,
          html: cuerpoHtml(),
          attachments: logos,
        },
        { enqueue: false, tipo: 'alfa-convenio-mexico-test' }
      );
      console.log('OK prueba messageId:', info?.messageId || info);
      await mongoose.disconnect();
      return;
    }

    if (!args.apply) {
      console.log('\nDry-run. Para enviar de verdad:');
      console.log('  node scripts/enviarCorreoMasivoConvenioMexicoAlfa.js --apply');
      const previewPath = path.join(__dirname, `_preview_convenio_mexico_alfa_${Date.now()}.json`);
      fs.writeFileSync(
        previewPath,
        JSON.stringify(
          destinatarios.map((d) => ({
            email: d.email,
            asegurado: d.asegurado,
            siniestro: d.siniestro,
            casos: d.casoIds.length,
          })),
          null,
          2
        )
      );
      console.log('Lista preview:', previewPath);
      await mongoose.disconnect();
      return;
    }

    const log = { startedAt: new Date().toISOString(), ok: [], fail: [] };
    const logos = adjuntosLogos();
    console.log(`Logos adjuntos: ${logos.map((a) => a.filename).join(', ') || 'NINGUNO'}`);

    for (let i = 0; i < destinatarios.length; i++) {
      const d = destinatarios[i];
      const n = i + 1;
      try {
        const info = await deliverMail(
          {
            to: d.email,
            subject: ASUNTO,
            text: CUERPO_TEXTO,
            html: cuerpoHtml(),
            attachments: logos,
          },
          { enqueue: false, tipo: 'alfa-convenio-mexico' }
        );
        const messageId = info?.messageId || '';
        await SegurosAlfaCaso.updateMany(
          { _id: { $in: d.casoIds } },
          {
            $set: {
              fechaEmailConvenioMexico: new Date(),
              emailConvenioMexicoMessageId: messageId,
            },
          }
        );
        log.ok.push({ email: d.email, messageId, casos: d.casoIds.length });
        console.log(`[${n}/${destinatarios.length}] OK ${d.email}`);
      } catch (err) {
        log.fail.push({ email: d.email, error: err?.message || String(err) });
        console.error(`[${n}/${destinatarios.length}] FAIL ${d.email}:`, err?.message || err);
      }
      if (i < destinatarios.length - 1) await sleep(args.delay);
    }

    log.finishedAt = new Date().toISOString();
    log.summary = { ok: log.ok.length, fail: log.fail.length };
    const logPath = path.join(__dirname, `_log_convenio_mexico_alfa_${Date.now()}.json`);
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
