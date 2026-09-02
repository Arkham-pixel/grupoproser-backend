/**
 * Envío masivo: videoperitaje GRUPO PROSER → asegurados BBVA (Excel).
 *
 * Uso:
 *   node scripts/enviarCorreoMasivoVideoperitajeBbva.js
 *   node scripts/enviarCorreoMasivoVideoperitajeBbva.js --test=tu@correo.com
 *   node scripts/enviarCorreoMasivoVideoperitajeBbva.js --apply
 *   node scripts/enviarCorreoMasivoVideoperitajeBbva.js --apply --limit=10
 *   node scripts/enviarCorreoMasivoVideoperitajeBbva.js --apply --only=correo@dominio.com
 *   node scripts/enviarCorreoMasivoVideoperitajeBbva.js --apply --force
 *   node scripts/enviarCorreoMasivoVideoperitajeBbva.js --apply --delay=1500
 *   node scripts/enviarCorreoMasivoVideoperitajeBbva.js --excel="C:\\ruta\\archivo.xlsx"
 *
 * Por defecto NO envía (dry-run: lista destinatarios y escribe preview HTML).
 */
import dns from 'dns';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { deliverMail, isMailConfigured, getMailConfigStatus } from '../services/mailTransport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const ASSETS_EMAIL = path.join(__dirname, '..', 'assets', 'email');
const LOGO_PROSER = path.join(ASSETS_EMAIL, 'logo-grupoproser.png');
const LOGO_BBVA = path.join(ASSETS_EMAIL, 'logo-bbva.png');
const ICON_WA = path.join(ASSETS_EMAIL, 'icon-whatsapp.png');
const LOCK_PATH = path.join(__dirname, '.lock_videoperitaje_bbva');
const SENT_LOG_PATH = path.join(__dirname, '_log_videoperitaje_bbva_enviados.json');
const PREVIEW_HTML = path.join(ASSETS_EMAIL, '_preview_videoperitaje_bbva.html');
const PREVIEW_DOWNLOADS = path.join(
  process.env.USERPROFILE || '',
  'Downloads',
  'preview_videoperitaje_bbva.html'
);

const EXCEL_DEFAULT = path.join(
  process.env.USERPROFILE || '',
  'Downloads',
  'EnvioMasivo20260901.xlsx'
);

const URL_CALENDLY = 'https://calendly.com/grupo-proser/new-meeting';
const URL_WHATSAPP =
  'https://api.whatsapp.com/send/?phone=573006347645&text&type=phone_number&app_absent=0';

const ASUNTO = 'Grupo Proser — Agende su Videoperitaje (BBVA Seguros)';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'do', 'das', 'e']);

function capitalizarNombre(raw) {
  const parts = String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);
  return parts
    .map((w, i) => {
      const lower = w.toLocaleLowerCase('es-CO');
      if (i > 0 && PARTICULAS.has(lower)) return lower;
      return lower.charAt(0).toLocaleUpperCase('es-CO') + lower.slice(1);
    })
    .join(' ');
}

function normalizarCampoCorreo(raw) {
  return String(raw || '')
    .replace(/\s+@\s*/g, '@')
    .replace(/@gmailcom\b/gi, '@gmail.com')
    .replace(/@hotmailcom\b/gi, '@hotmail.com')
    .replace(/@yahooes\b/gi, '@yahoo.es');
}

function limpiarEmail(rawEmail) {
  let email = String(rawEmail || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  let local = email.slice(0, at).replace(/\s+/g, '');
  const domain = email.slice(at + 1).replace(/\s+/g, '');
  email = `${local}@${domain}`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (email.endsWith('.con') || email.endsWith('gmailcom') || email.endsWith('hotmailcom')) {
    return null;
  }
  return email;
}

function extraerEmails(raw) {
  const text = normalizarCampoCorreo(raw);
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

function parseArgs(argv) {
  const out = {
    apply: false,
    force: false,
    limit: null,
    delay: 1500,
    test: null,
    only: null,
    excel: EXCEL_DEFAULT,
  };
  for (const a of argv) {
    if (a === '--apply') out.apply = true;
    else if (a === '--force') out.force = true;
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8)) || null;
    else if (a.startsWith('--delay=')) out.delay = Math.max(200, Number(a.slice(8)) || 1500);
    else if (a.startsWith('--test=')) out.test = String(a.slice(7)).trim().toLowerCase() || null;
    else if (a.startsWith('--only=')) out.only = String(a.slice(7)).trim().toLowerCase() || null;
    else if (a.startsWith('--excel=')) out.excel = String(a.slice(8)).replace(/^["']|["']$/g, '');
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function leerEnviados() {
  try {
    if (!fs.existsSync(SENT_LOG_PATH)) return new Set();
    const data = JSON.parse(fs.readFileSync(SENT_LOG_PATH, 'utf8'));
    const list = Array.isArray(data) ? data : data.emails || [];
    return new Set(list.map((e) => String(e).toLowerCase()));
  } catch {
    return new Set();
  }
}

function guardarEnviados(set) {
  fs.writeFileSync(
    SENT_LOG_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), emails: [...set].sort() }, null, 2)
  );
}

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
  if (fs.existsSync(LOGO_BBVA)) {
    attachments.push({
      filename: 'logo-bbva.png',
      path: LOGO_BBVA,
      cid: 'logoBbva',
      contentDisposition: 'inline',
    });
  }
  if (fs.existsSync(ICON_WA)) {
    attachments.push({
      filename: 'icon-whatsapp.png',
      path: ICON_WA,
      cid: 'iconWhatsapp',
      contentDisposition: 'inline',
    });
  }
  return attachments;
}

function fileUri(filePath) {
  return `file:///${String(filePath).replace(/\\/g, '/')}`;
}

function srcImagen(modoPreview, cid, filePath) {
  if (!modoPreview) return `cid:${cid}`;
  return fileUri(filePath);
}

function cuerpoTexto(nombreVisible) {
  return `Estimado(a) Sr(a) ${nombreVisible},
Un gusto en saludarle.

En nombre del Grupo Proser le estamos contactando con motivo del aviso de siniestro que usted presentó a BBVA. Somos la firma encargada de validar la pérdida y de ayudarle a establecer el valor de la reclamación.

Antes que todo, mil gracias por atendernos y nuestro abrazo de solidaridad ante el difícil momento que usted, sus familiares, amigos y vecinos están atravesando.

Es necesario que realicemos una inspección del predio afectado. En la medida en que tenemos muchos inmuebles para revisar, la compañía ha pensado en su comodidad y, para agilizar el proceso, la inspección se realizará por medio de Videoperitaje, es decir por una videollamada desde su celular, atendida directamente por profesionales en Arquitectura o Ingeniería Civil con la idoneidad y conocimientos pertinentes para analizar su caso.

Agende su Videoperitaje aquí:
${URL_CALENDLY}

Unos minutos antes de la cita agendada por usted, recibirá un mensaje de texto (SMS) y/o un correo con el enlace a nuestra plataforma y unas sencillas instrucciones para poder realizar el Videoperitaje. Para que la llamada sea exitosa por favor:
- procure que estén bien iluminados los espacios
- tener un metro a la mano y una persona que le acompañe para poder hacer las mediciones mientras usted sostiene el celular
- contar con buena señal de internet en su celular

De igual manera, estamos a su completa disposición para despejar cualquier duda respecto de este proceso.

Comuníquese con nuestro equipo de trabajo por WhatsApp:
${URL_WHATSAPP}

Gracias por su atención, cordial saludo,

GRUPO PROSER
`;
}

function cuerpoHtml(nombreVisible, { preview = false } = {}) {
  const tieneProser = fs.existsSync(LOGO_PROSER);
  const tieneBbva = fs.existsSync(LOGO_BBVA);
  const tieneWa = fs.existsSync(ICON_WA);
  const srcProser = srcImagen(preview, 'logoProser', LOGO_PROSER);
  const srcBbva = srcImagen(preview, 'logoBbva', LOGO_BBVA);
  const srcWa = srcImagen(preview, 'iconWhatsapp', ICON_WA);

  const celdaProser = tieneProser
    ? `<img src="${srcProser}" alt="GRUPO PROSER" width="180" style="display:block;max-width:180px;height:auto;border:0;" />`
    : `<span style="color:#0f172a;font-size:15px;font-weight:bold;">GRUPO PROSER</span>`;
  const celdaBbva = tieneBbva
    ? `<img src="${srcBbva}" alt="BBVA Seguros" width="160" style="display:block;max-width:160px;height:auto;border:0;margin-left:auto;" />`
    : `<span style="color:#072146;font-size:15px;font-weight:bold;">BBVA Seguros</span>`;
  const iconoWa = tieneWa
    ? `<img src="${srcWa}" alt="WhatsApp" width="32" height="32" style="display:block;border:0;width:32px;height:32px;" />`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="background:#ffffff;padding:20px 28px;border-bottom:1px solid #e5e7eb;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="left" valign="middle" width="50%">${celdaProser}</td>
                  <td align="right" valign="middle" width="50%">${celdaBbva}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#072146;color:#ffffff;padding:12px 28px;font-size:13px;font-weight:bold;letter-spacing:0.02em;">
              Videoperitaje · Reclamación BBVA Seguros
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-size:15px;line-height:1.6;color:#1f2937;">
              <p style="margin:0 0 14px;">Estimado(a) Sr(a) ${escapeHtml(nombreVisible)},</p>
              <p style="margin:0 0 14px;">Un gusto en saludarle.</p>
              <p style="margin:0 0 14px;">
                En nombre del Grupo Proser le estamos contactando con motivo del aviso de siniestro que usted presentó a BBVA. Somos la firma encargada de validar la pérdida y de ayudarle a establecer el valor de la reclamación.
              </p>
              <p style="margin:0 0 14px;">
                Antes que todo, mil gracias por atendernos y nuestro abrazo de solidaridad ante el difícil momento que usted, sus familiares, amigos y vecinos están atravesando.
              </p>
              <p style="margin:0 0 18px;">
                Es necesario que realicemos una inspección del predio afectado. En la medida en que tenemos muchos inmuebles para revisar, la compañía ha pensado en su comodidad y, para agilizar el proceso, la inspección se realizará por medio de Videoperitaje, es decir por una videollamada desde su celular, atendida directamente por profesionales en Arquitectura o Ingeniería Civil con la idoneidad y conocimientos pertinentes para analizar su caso. Haga clic en el siguiente botón para agendar su Videoperitaje:
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto 22px;">
                <tr>
                  <td align="center" bgcolor="#2B7DE9" style="border-radius:8px;">
                    <a href="${URL_CALENDLY}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">Agendar mi Videoperitaje</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 10px;">
                Unos minutos antes de la cita agendada por usted, recibirá un mensaje de texto (SMS) y/o un correo con el enlace a nuestra plataforma y unas sencillas instrucciones para poder realizar el Videoperitaje. Para que la llamada sea exitosa por favor:
              </p>
              <ul style="margin:0 0 18px;padding-left:22px;">
                <li style="margin:0 0 6px;">procure que estén bien iluminados los espacios</li>
                <li style="margin:0 0 6px;">tener un metro a la mano y una persona que le acompañe para poder hacer las mediciones mientras usted sostiene el celular</li>
                <li style="margin:0 0 6px;">contar con buena señal de internet en su celular</li>
              </ul>
              <p style="margin:0 0 18px;">
                De igual manera, estamos a su completa disposición para despejar cualquier duda respecto de este proceso. Haga clic en el siguiente botón para comunicarse con nuestro equipo de trabajo:
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto 22px;">
                <tr>
                  <td bgcolor="#25D366" style="border-radius:8px;">
                    <a href="${URL_WHATSAPP}" target="_blank" style="text-decoration:none;">
                      <table role="presentation" cellspacing="0" cellpadding="0">
                        <tr>
                          <td valign="middle" style="padding:13px 14px 13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;">
                            Hablar por WhatsApp
                          </td>
                          <td valign="middle" style="padding:8px 16px 8px 4px;">
                            ${iconoWa}
                          </td>
                        </tr>
                      </table>
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 6px;">Gracias por su atención, cordial saludo,</p>
              <p style="margin:16px 0 0;">
                <strong>GRUPO PROSER</strong>
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

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escribirPreview(nombreVisible) {
  const html = cuerpoHtml(nombreVisible, { preview: true });
  fs.writeFileSync(PREVIEW_HTML, html, 'utf8');
  try {
    if (PREVIEW_DOWNLOADS) fs.writeFileSync(PREVIEW_DOWNLOADS, html, 'utf8');
  } catch {
    /* ignore */
  }
  return PREVIEW_DOWNLOADS || PREVIEW_HTML;
}

function leerDestinatarios(excelPath) {
  if (!fs.existsSync(excelPath)) {
    throw new Error(`No existe el Excel: ${excelPath}`);
  }
  const wb = XLSX.readFile(excelPath);
  const sheetName = wb.SheetNames.find((n) => /matriz/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });

  /** @type {Map<string, { email: string, nombre: string, siniestros: string[] }>} */
  const byEmail = new Map();
  const omitidos = [];
  let filasMulti = 0;

  for (const r of rows) {
    const nombreRaw = String(r['NOMBRE ASEGURADO '] || r['NOMBRE ASEGURADO'] || r.Nombre || '').trim();
    const siniestro = String(r.NSINIESTRO || r.siniestro || '').trim();
    const emails = extraerEmails(r.Correo || r.correo || r.Email || '');
    if (!emails.length) {
      omitidos.push({
        siniestro,
        nombre: nombreRaw,
        correo: String(r.Correo || r.correo || ''),
      });
      continue;
    }
    if (emails.length > 1) filasMulti += 1;
    const nombre = capitalizarNombre(nombreRaw) || 'asegurado(a)';
    for (const email of emails) {
      if (!byEmail.has(email)) {
        byEmail.set(email, { email, nombre, siniestros: [] });
      }
      const row = byEmail.get(email);
      if (siniestro && !row.siniestros.includes(siniestro)) row.siniestros.push(siniestro);
      if (!row.nombre && nombre) row.nombre = nombre;
    }
  }

  return {
    sheetName,
    filas: rows.length,
    destinatarios: [...byEmail.values()],
    omitidos,
    filasMulti,
  };
}

function adquirirLock() {
  if (fs.existsSync(LOCK_PATH)) {
    const prev = fs.readFileSync(LOCK_PATH, 'utf8').trim();
    throw new Error(`Ya hay un envío de videoperitaje BBVA en curso (lock: ${prev}). Espere o borre ${LOCK_PATH}`);
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

  console.log('Mail config:', getMailConfigStatus());
  if ((args.apply || args.test) && !isMailConfigured()) {
    console.error('EMAIL_USER / EMAIL_PASS no configurados.');
    process.exit(1);
  }

  const { sheetName, filas, destinatarios: todos, omitidos, filasMulti } = leerDestinatarios(args.excel);
  const enviadosPrevios = leerEnviados();

  let destinatarios = todos;
  if (args.only) destinatarios = destinatarios.filter((d) => d.email === args.only);
  if (!args.force) destinatarios = destinatarios.filter((d) => !enviadosPrevios.has(d.email));
  if (args.limit != null && args.limit > 0) destinatarios = destinatarios.slice(0, args.limit);

  const ejemplo = todos[0] || { nombre: 'Alejandro Beltrán Otálora', email: 'ejemplo@correo.com' };
  const previewPath = escribirPreview(ejemplo.nombre);

  console.log(
    JSON.stringify(
      {
        excel: args.excel,
        hoja: sheetName,
        filasExcel: filas,
        filasSinCorreoUtil: omitidos.length,
        filasConVariosCorreos: filasMulti,
        correosUnicos: todos.length,
        yaEnviadosOmitidos: args.force ? 0 : [...todos].filter((d) => enviadosPrevios.has(d.email)).length,
        aEnviar: destinatarios.length,
        modo: args.test ? `TEST → ${args.test}` : args.apply ? 'APPLY' : 'DRY-RUN',
        delayMs: args.delay,
        previewHtml: previewPath,
        omitidos,
      },
      null,
      2
    )
  );

  if (args.test) {
    console.log(`Enviando prueba a ${args.test} (nombre de ejemplo: ${ejemplo.nombre})…`);
    const logos = adjuntosLogos();
    console.log(`Logos adjuntos: ${logos.map((a) => a.filename).join(', ') || 'NINGUNO'}`);
    const info = await deliverMail(
      {
        to: args.test,
        subject: `[PRUEBA] ${ASUNTO}`,
        text: cuerpoTexto(ejemplo.nombre),
        html: cuerpoHtml(ejemplo.nombre),
        attachments: logos,
      },
      { enqueue: false, tipo: 'bbva-videoperitaje-test' }
    );
    console.log('OK prueba messageId:', info?.messageId || info);
    return;
  }

  if (!args.apply) {
    console.log('\nDry-run. Para enviar de verdad:');
    console.log('  node scripts/enviarCorreoMasivoVideoperitajeBbva.js --apply');
    console.log('  node scripts/enviarCorreoMasivoVideoperitajeBbva.js --test=tu@correo.com');
    const previewJson = path.join(__dirname, `_preview_videoperitaje_bbva_${Date.now()}.json`);
    fs.writeFileSync(
      previewJson,
      JSON.stringify(
        destinatarios.map((d) => ({
          email: d.email,
          nombre: d.nombre,
          siniestros: d.siniestros,
        })),
        null,
        2
      )
    );
    console.log('Lista preview:', previewJson);
    return;
  }

  adquirirLock();
  const log = { startedAt: new Date().toISOString(), ok: [], fail: [] };
  const logos = adjuntosLogos();
  console.log(`Logos adjuntos: ${logos.map((a) => a.filename).join(', ') || 'NINGUNO'}`);

  try {
    for (let i = 0; i < destinatarios.length; i++) {
      const d = destinatarios[i];
      const n = i + 1;
      try {
        const info = await deliverMail(
          {
            to: d.email,
            subject: ASUNTO,
            text: cuerpoTexto(d.nombre),
            html: cuerpoHtml(d.nombre),
            attachments: logos,
          },
          { enqueue: false, tipo: 'bbva-videoperitaje' }
        );
        const messageId = info?.messageId || '';
        enviadosPrevios.add(d.email);
        log.ok.push({ email: d.email, nombre: d.nombre, messageId, siniestros: d.siniestros });
        console.log(`[${n}/${destinatarios.length}] OK ${d.email}`);
      } catch (err) {
        log.fail.push({ email: d.email, nombre: d.nombre, error: err?.message || String(err) });
        console.error(`[${n}/${destinatarios.length}] FAIL ${d.email}:`, err?.message || err);
      }
      if (i < destinatarios.length - 1) await sleep(args.delay);
      if (n % 25 === 0) guardarEnviados(enviadosPrevios);
    }
  } finally {
    guardarEnviados(enviadosPrevios);
    soltarLock();
  }

  log.finishedAt = new Date().toISOString();
  log.summary = { ok: log.ok.length, fail: log.fail.length };
  const logPath = path.join(__dirname, `_log_videoperitaje_bbva_${Date.now()}.json`);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log('\nResumen:', log.summary);
  console.log('Log:', logPath);
  if (log.fail.length) process.exitCode = 2;
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
