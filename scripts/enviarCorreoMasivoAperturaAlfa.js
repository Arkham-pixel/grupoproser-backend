/**
 * Envío masivo: correo de apertura PROSER Ajustes → asegurados Seguros Alfa.
 *
 * Uso:
 *   node scripts/enviarCorreoMasivoAperturaAlfa.js              # dry-run
 *   node scripts/enviarCorreoMasivoAperturaAlfa.js --test=tu@correo.com
 *   node scripts/enviarCorreoMasivoAperturaAlfa.js --apply
 *   node scripts/enviarCorreoMasivoAperturaAlfa.js --apply --limit=10
 *   node scripts/enviarCorreoMasivoAperturaAlfa.js --apply --force   # reenvía aunque ya tenga fecha
 *   node scripts/enviarCorreoMasivoAperturaAlfa.js --apply --delay=1500
 *
 * Por defecto NO envía (solo lista destinatarios). Con --apply marca
 * fechaEmailAperturaProser en cada caso vinculado al correo.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { deliverMail, isMailConfigured, getMailConfigStatus } from '../services/mailTransport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_EMAIL = path.join(__dirname, '..', 'assets', 'email');
const LOGO_PROSER = path.join(ASSETS_EMAIL, 'logo-grupoproser.png');
const LOGO_ALFA = path.join(ASSETS_EMAIL, 'logo-seguros-alfa.png');

const ASUNTO =
  'Proser Ajustes — Atención de su reclamación Seguros Alfa';

const CUERPO_TEXTO = `Estimado(a) asegurado(a):

Reciba un cordial saludo.

Nos permitimos informarle que Proser Ajustes ha sido designado por Seguros Alfa para acompañar la atención y gestión técnica de su reclamación, relacionada con el evento reportado.

Queremos brindarle tranquilidad y confirmarle que su caso se encuentra en proceso de gestión. En los próximos días, uno de nuestros profesionales se comunicará con usted para coordinar la inspección y continuar con la atención correspondiente.

Debido al número de reclamaciones generadas por el evento presentado, nuestro equipo se encuentra trabajando para atender cada caso de manera oportuna. Agradecemos su comprensión mientras avanzamos con el proceso de atención.

Con el fin de agilizar la revisión durante la visita de inspección, le recomendamos tener disponibles, en caso de contar con ellos, los siguientes documentos:

• Carta con descripción del evento y de las afectaciones presentadas.
• Registro fotográfico de los daños.
• Facturas o cotizaciones relacionadas con la estimación de las reparaciones.
• Certificado de tradición y libertad del inmueble.

En caso de no contar con esta información, no se preocupe; nuestro equipo técnico realizará la verificación correspondiente durante la visita, lo orientará sobre los daños identificados y podrá apoyarlo con la estimación de las reparaciones requeridas. De esta manera, podrá avanzar en el proceso de atención aun cuando no tenga previamente todos los documentos solicitados.

No es necesario responder este correo.

Agradecemos su colaboración y reiteramos nuestro compromiso de acompañarlo y orientarlo durante la gestión de su reclamación.

Cordialmente,

Proser Ajustes
Ajustadores designados por Seguros Alfa
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
    ? `<img src="cid:logoProser" alt="Proser Ajustes" width="150" height="48" style="display:block;max-width:150px;height:auto;border:0;" />`
    : `<span style="color:#0f172a;font-size:15px;font-weight:bold;">Proser Ajustes</span>`;
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
              Atención de reclamación · Evento sísmico
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-size:14px;line-height:1.55;color:#1f2937;">
              <p style="margin:0 0 14px;">Estimado(a) asegurado(a):</p>
              <p style="margin:0 0 14px;">Reciba un cordial saludo.</p>
              <p style="margin:0 0 14px;">
                Nos permitimos informarle que <strong>Proser Ajustes</strong> ha sido designado por
                <strong>Seguros Alfa</strong> para acompañar la atención y gestión técnica de su
                reclamación, relacionada con el evento reportado.
              </p>
              <p style="margin:0 0 14px;">
                Queremos brindarle tranquilidad y confirmarle que su caso se encuentra en proceso de
                gestión. En los próximos días, uno de nuestros profesionales se comunicará con usted
                para coordinar la inspección y continuar con la atención correspondiente.
              </p>
              <p style="margin:0 0 14px;">
                Debido al número de reclamaciones generadas por el evento presentado, nuestro equipo
                se encuentra trabajando para atender cada caso de manera oportuna. Agradecemos su
                comprensión mientras avanzamos con el proceso de atención.
              </p>
              <p style="margin:0 0 10px;">
                Con el fin de agilizar la revisión durante la visita de inspección, le recomendamos
                tener disponibles, en caso de contar con ellos, los siguientes documentos:
              </p>
              <ul style="margin:0 0 14px;padding-left:20px;">
                <li>Carta con descripción del evento y de las afectaciones presentadas.</li>
                <li>Registro fotográfico de los daños.</li>
                <li>Facturas o cotizaciones relacionadas con la estimación de las reparaciones.</li>
                <li>Certificado de tradición y libertad del inmueble.</li>
              </ul>
              <p style="margin:0 0 14px;">
                En caso de no contar con esta información, no se preocupe; nuestro equipo técnico
                realizará la verificación correspondiente durante la visita, lo orientará sobre los
                daños identificados y podrá apoyarlo con la estimación de las reparaciones
                requeridas. De esta manera, podrá avanzar en el proceso de atención aun cuando no
                tenga previamente todos los documentos solicitados.
              </p>
              <p style="margin:0 0 14px;"><em>No es necesario responder este correo.</em></p>
              <p style="margin:0 0 18px;">
                Agradecemos su colaboración y reiteramos nuestro compromiso de acompañarlo y
                orientarlo durante la gestión de su reclamación.
              </p>
              <p style="margin:0;">
                Cordialmente,<br /><br />
                <strong>Proser Ajustes</strong><br />
                Ajustadores designados por Seguros Alfa
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

function extraerEmails(raw) {
  const text = String(raw || '');
  const found = text.match(EMAIL_RE) || [];
  const out = [];
  const seen = new Set();
  for (const e of found) {
    const email = e.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    // descarta typos obvios tipo gmailcom sin punto
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
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
    delay: 1200,
    test: null,
  };
  for (const a of argv) {
    if (a === '--apply') out.apply = true;
    else if (a === '--force') out.force = true;
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8)) || null;
    else if (a.startsWith('--delay=')) out.delay = Math.max(200, Number(a.slice(8)) || 1200);
    else if (a.startsWith('--test=')) out.test = String(a.slice(7)).trim().toLowerCase() || null;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('Falta MONGO_URI');
    process.exit(1);
  }

  console.log('Mail config:', getMailConfigStatus());
  if ((args.apply || args.test) && !isMailConfigured()) {
    console.error('EMAIL_USER / EMAIL_PASS no configurados.');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const casos = await SegurosAlfaCaso.find({})
    .select('_id correo asegurado tomador siniestro fechaEmailAperturaProser')
    .lean();

  /** @type {Map<string, { email: string, casoIds: string[], yaEnviado: boolean, asegurado: string }>} */
  const byEmail = new Map();
  let sinCorreo = 0;

  for (const c of casos) {
    const emails = extraerEmails(c.correo);
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
        });
      }
      const row = byEmail.get(email);
      row.casoIds.push(String(c._id));
      if (c.fechaEmailAperturaProser) row.yaEnviado = true;
      if (!row.asegurado) row.asegurado = c.asegurado || c.tomador || '';
    }
  }

  let destinatarios = [...byEmail.values()];
  if (!args.force) {
    destinatarios = destinatarios.filter((d) => !d.yaEnviado);
  }
  if (args.limit != null && args.limit > 0) {
    destinatarios = destinatarios.slice(0, args.limit);
  }

  console.log(
    JSON.stringify(
      {
        totalCasos: casos.length,
        sinCorreoUtil: sinCorreo,
        correosUnicosEnBd: byEmail.size,
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
    console.log(`Enviando prueba a ${args.test}…`);
    const logos = adjuntosLogos();
    console.log(`Logos adjuntos: ${logos.map((a) => a.filename).join(', ') || 'NINGUNO'}`);
    const info = await deliverMail({
      to: args.test,
      subject: `[PRUEBA] ${ASUNTO}`,
      text: CUERPO_TEXTO,
      html: cuerpoHtml(),
      attachments: logos,
    });
    console.log('OK prueba messageId:', info?.messageId || info);
    await mongoose.disconnect();
    return;
  }

  if (!args.apply) {
    console.log('\nDry-run. Para enviar de verdad:');
    console.log('  node scripts/enviarCorreoMasivoAperturaAlfa.js --apply');
    console.log('  node scripts/enviarCorreoMasivoAperturaAlfa.js --test=tu@correo.com');
    const previewPath = path.join(__dirname, `_preview_apertura_alfa_${Date.now()}.json`);
    fs.writeFileSync(
      previewPath,
      JSON.stringify(
        destinatarios.map((d) => ({
          email: d.email,
          asegurado: d.asegurado,
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
      const info = await deliverMail({
        to: d.email,
        subject: ASUNTO,
        text: CUERPO_TEXTO,
        html: cuerpoHtml(),
        attachments: logos,
      });
      const messageId = info?.messageId || '';
      await SegurosAlfaCaso.updateMany(
        { _id: { $in: d.casoIds } },
        {
          $set: {
            fechaEmailAperturaProser: new Date(),
            emailAperturaProserMessageId: messageId,
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
  const logPath = path.join(__dirname, `_log_apertura_alfa_${Date.now()}.json`);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log('\nResumen:', log.summary);
  console.log('Log:', logPath);

  await mongoose.disconnect();
  if (log.fail.length) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
