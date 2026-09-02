/**
 * PDF interno: usuarios ERA con logos Grupo Proser y Proser Puertos.
 * Uso: node scripts/pdf_usuarios_era.js
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  path.join(__dirname, '../../grupoproser-frontend/package.json')
);
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const LOGO_GRUPO = path.join(__dirname, '../../grupoproser-frontend/public/templates/logo-grupoproser.png');
const LOGO_PUERTOS = path.join(__dirname, '../../grupoproser-frontend/public/templates/logo-proserpuertos.jpg');
const OUT_PATH = path.join(__dirname, '../../Usuarios_ERA.pdf');

const NAVY = rgb(7 / 255, 33 / 255, 70 / 255);
const BLUE = rgb(43 / 255, 125 / 255, 233 / 255);
const INK = rgb(17 / 255, 24 / 255, 39 / 255);
const MUTED = rgb(75 / 255, 85 / 255, 99 / 255);
const LINE = rgb(229 / 255, 231 / 255, 235 / 255);
const ROW = rgb(248 / 255, 250 / 255, 252 / 255);
const AMBER_BG = rgb(255 / 255, 251 / 255, 235 / 255);
const AMBER = rgb(146 / 255, 64 / 255, 14 / 255);
const WHITE = rgb(1, 1, 1);

const PERSONAS = [
  ['Erick Aramis Quevedo Gonzalez', '4201038754011', 'erick.quevedo@erareinsurance.com'],
  ['César Rodríguez Gutiérrez', '2272085666324', 'cesar.rodriguez@qm-adjusters.com.mx'],
  ['Fernando Murillo Ánimas', '1003038350891', 'fernando.murillo@qm-adjusters.com.mx'],
  ['Ángel Jael Soto Cruz', '3987100038612', 'angel.soto@qm-adjusters.com.mx'],
  ['Rogelio Montoya de la Vega', '5473026805654', 'rogelio.montoya@qm-adjusters.com.mx'],
  ['Yolanda Iris Vázquez Martínez', '3744082652881', 'yolanda.vazquez@qm-adjusters.com.mx'],
  ['Mitzy Yuriko Rangel Marin', '4240092522140', 'yurikogrimm1225@gmail.com'],
  ['Mauricio Alfredo Zamora Hernandez', '0815104122085', 'mauricioalfredo48@gmail.com'],
  ['Jose Angel Flores Mena', '2372119921487', 'angel.flores3dtm@gmail.com'],
  ['Miguel Angel Bojorges Mendez', '1997082904240', 'mbojorqesm@outlook.com'],
  ['Jorge Luis Perez Angulo', '0519072577601', 'eg_rojsiul@hotmail.com'],
];

const PASSWORD = 'Externos2026*';

function fit(img, maxW, maxH) {
  const r = Math.min(maxW / img.width, maxH / img.height);
  return { w: img.width * r, h: img.height * r };
}

function drawText(page, text, x, y, size, font, color = INK) {
  page.drawText(String(text || ''), { x, y, size, font, color });
}

async function main() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const logoGrupo = await pdf.embedPng(fs.readFileSync(LOGO_GRUPO));
  const logoPuertos = await pdf.embedJpg(fs.readFileSync(LOGO_PUERTOS));

  const m = 36;
  let y = height - 28;

  page.drawRectangle({ x: 0, y: height - 96, width, height: 96, color: WHITE });
  const g = fit(logoGrupo, 168, 48);
  const p = fit(logoPuertos, 158, 48);
  page.drawImage(logoGrupo, { x: m, y: height - 28 - g.h, width: g.w, height: g.h });
  page.drawImage(logoPuertos, {
    x: width - m - p.w,
    y: height - 28 - p.h,
    width: p.w,
    height: p.h,
  });

  y = height - 108;
  page.drawRectangle({ x: 0, y: y - 8, width, height: 36, color: NAVY });
  drawText(page, 'Credenciales de acceso  ·  Rol ERA', m, y + 4, 13, bold, WHITE);
  y -= 28;

  drawText(page, 'Arnald DataFlow  |  Grupo Proser  |  Uso interno', m, y, 9, font, MUTED);
  y -= 14;
  drawText(
    page,
    'Módulos: Previsora, Zurich, BBVA CAT, Alfa, Sura, Allianz y Equidad CAT  (sin Equidad FDM)',
    m,
    y,
    8,
    font,
    MUTED
  );
  y -= 22;

  page.drawRectangle({
    x: m,
    y: y - 38,
    width: width - m * 2,
    height: 50,
    color: AMBER_BG,
    borderColor: rgb(253 / 255, 230 / 255, 138 / 255),
    borderWidth: 1,
  });
  drawText(page, 'Contraseña para todos los usuarios', m + 12, y - 6, 8, font, AMBER);
  drawText(page, PASSWORD, m + 12, y - 26, 14, bold, NAVY);
  drawText(page, 'Usuario = número de identificación (INE)', m + 250, y - 22, 8, font, MUTED);
  y -= 64;

  const cols = [
    { key: 'n', title: '#', w: 24 },
    { key: 'nombre', title: 'Nombre completo', w: 188 },
    { key: 'login', title: 'Usuario (INE)', w: 108 },
    { key: 'email', title: 'Correo', w: 187 },
  ];
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const rowH = 18;
  const headH = 20;

  page.drawRectangle({ x: m, y: y - headH, width: tableW, height: headH, color: NAVY });
  let x = m;
  for (const col of cols) {
    drawText(page, col.title, x + 6, y - 14, 8, bold, WHITE);
    x += col.w;
  }
  y -= headH;

  PERSONAS.forEach((persona, i) => {
    const [nombre, login, email] = persona;
    if (i % 2 === 0) {
      page.drawRectangle({ x: m, y: y - rowH, width: tableW, height: rowH, color: ROW });
    }
    page.drawRectangle({
      x: m,
      y: y - rowH,
      width: tableW,
      height: rowH,
      borderColor: LINE,
      borderWidth: 0.4,
    });
    const vals = [String(i + 1), nombre, login, email];
    x = m;
    vals.forEach((val, ci) => {
      const fnt = ci === 2 ? bold : font;
      const size = ci === 3 ? 7 : 8;
      drawText(page, val, x + 6, y - 12, size, fnt, INK);
      x += cols[ci].w;
    });
    y -= rowH;
  });

  y -= 22;
  drawText(page, 'Cómo ingresar', m, y, 11, bold, NAVY);
  y -= 16;
  const pasos = [
    '1. Abrir la plataforma e ir a Iniciar sesión.',
    '2. En Usuario, escribir el número de identificación (INE) de la tabla.',
    `3. En Contraseña, escribir: ${PASSWORD}`,
    '4. Al entrar se abre Previsora. En el menú están Allianz y los demás módulos catastróficos (excepto FDM).',
    '5. Cambiar la contraseña en Mi Cuenta después del primer acceso.',
  ];
  for (const paso of pasos) {
    drawText(page, paso, m, y, 8.5, font, INK);
    y -= 13;
  }

  y -= 10;
  page.drawRectangle({ x: m, y: y - 52, width: tableW, height: 56, color: rgb(239 / 255, 246 / 255, 255 / 255) });
  drawText(page, 'Notas de seguridad', m + 10, y - 12, 8, bold, BLUE);
  drawText(
    page,
    'Documento confidencial. No compartir por canales públicos. Entregar credenciales de forma individual.',
    m + 10,
    y - 26,
    8,
    font,
    INK
  );
  drawText(
    page,
    'Estos usuarios no tienen acceso a Equidad FDM, Express, Complex ni Administración.',
    m + 10,
    y - 40,
    8,
    font,
    INK
  );

  page.drawRectangle({ x: 0, y: 0, width, height: 28, color: NAVY });
  drawText(
    page,
    'GRUPO PROSER  ·  PROSER PUERTOS  ·  Usuarios ERA  ·  Generado el 2 de septiembre de 2026',
    m,
    10,
    7.5,
    font,
    WHITE
  );

  const bytes = await pdf.save();
  fs.writeFileSync(OUT_PATH, bytes);
  console.log(`PDF: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
