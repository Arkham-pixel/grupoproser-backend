/**
 * SOLO LECTURA — analiza encabezados + color de fondo del Excel oficial
 * SEGUROS ALFA/CONTROL Y SEGUIMIENTO.
 * NO modifica SharePoint ni Mongo.
 *
 * node scripts/analyzeAlfaExcelOwnershipColors.js
 */
import '../config/loadEnv.js';
import ExcelJS from 'exceljs';
import {
  listFolder,
  downloadDriveItemBuffer,
} from '../services/microsoftGraphService.js';
import { buildAlfaExcelHeaderLookup } from '../config/alfaExcelColumnMap.js';
import { normalizeExcelHeader } from '../utils/alfaExcelNormalize.js';

const SOURCE_PATH = 'SEGUROS ALFA/CONTROL Y SEGUIMIENTO';
const FILE_NAME =
  process.env.SHAREPOINT_ALFA_EXCEL_FILE_NAME ||
  'CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali.xlsx';

const HEADER_LOOKUP = buildAlfaExcelHeaderLookup();

function colLetter(zeroIdx) {
  let n = zeroIdx + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function argbToHex(argb) {
  if (!argb) return null;
  const s = String(argb).replace(/^#/, '').toUpperCase();
  if (s.length === 8) return `#${s.slice(2)}`; // drop alpha
  if (s.length === 6) return `#${s}`;
  return s;
}

function classifyFill(fill) {
  if (!fill) return { label: 'Sin relleno', hex: null, theme: null, pattern: null };
  const fg = fill.fgColor || {};
  const bg = fill.bgColor || {};
  const hex = argbToHex(fg.argb || bg.argb);
  const theme = fg.theme != null ? fg.theme : bg.theme != null ? bg.theme : null;
  const tint = fg.tint != null ? fg.tint : bg.tint != null ? bg.tint : null;
  const pattern = fill.pattern || fill.type || null;

  // Excel theme yellow / standard yellows commonly used for "ARNALD columns"
  const yellowHexes = new Set([
    'FFFF00',
    'FFFF99',
    'FFFFCC',
    'FFEB9C',
    'FFF2CC',
    'FFC000',
    'FFD966',
    'FFE699',
    'FFF2CC',
    'FFFF00',
    'FCE4D6', // sometimes peach; keep separate
  ]);

  let label = 'Otro';
  if (!hex && theme == null) label = 'Sin relleno / default';
  else if (hex) {
    const bare = hex.replace('#', '').toUpperCase();
    const r = parseInt(bare.slice(0, 2), 16);
    const g = parseInt(bare.slice(2, 4), 16);
    const b = parseInt(bare.slice(4, 6), 16);
    const isYellowish = r >= 200 && g >= 180 && b <= 160 && r - b > 40;
    const isExactYellow = yellowHexes.has(bare);
    if (isExactYellow || isYellowish) label = 'Amarillo';
    else if (r > 200 && g > 200 && b > 200) label = 'Gris claro / blanco';
    else if (r < 80 && g < 80 && b < 80) label = 'Oscuro';
    else label = `Color ${hex}`;
  } else if (theme != null) {
    // theme 4 often accent yellow in Office themes — report raw
    label = `Tema ${theme}${tint != null ? ` tint=${tint}` : ''}`;
  }

  return { label, hex, theme, tint, pattern };
}

function cellDisplay(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && value.text != null) return String(value.text);
  if (typeof value === 'object' && value.result != null) return String(value.result);
  return String(value);
}

async function selectExcel() {
  const listed = await listFolder(SOURCE_PATH, { top: 200 });
  const hit = (listed.children || []).find((c) => c.name === FILE_NAME && !c.folder);
  if (!hit) {
    throw new Error(
      `FILE_NOT_FOUND: ${FILE_NAME}. Disponibles: ${(listed.children || [])
        .map((c) => c.name)
        .join(' | ')}`
    );
  }
  return hit;
}

function findHeaderRow(ws) {
  const maxScan = Math.min(ws.rowCount || 40, 40);
  for (let r = 1; r <= maxScan; r += 1) {
    const row = ws.getRow(r);
    const fields = new Set();
    const headers = [];
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = cellDisplay(cell.value);
      const field = HEADER_LOOKUP.get(normalizeExcelHeader(text));
      headers.push({ col: colNumber, text, field });
      if (field) fields.add(field);
    });
    if (fields.has('identificacion') || (fields.has('siniestro') && fields.has('estado'))) {
      return { headerRowIdx1: r, headers, fields };
    }
  }
  return null;
}

async function main() {
  console.log('=== ANALYZE ALFA EXCEL OWNERSHIP (READ-ONLY) ===');
  console.log('path:', SOURCE_PATH);
  console.log('file:', FILE_NAME);

  const item = await selectExcel();
  console.log('itemId:', item.id);
  console.log('eTag:', item.eTag);
  console.log('lastModified:', item.lastModifiedDateTime);
  console.log('size:', item.size);

  const { buffer } = await downloadDriveItemBuffer({
    driveId: item.parentReference?.driveId || item.driveId,
    itemId: item.id,
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  console.log('\nHojas:', wb.worksheets.map((w) => w.name).join(' | '));

  const preferred = [];
  for (const name of ['BD', 'PENDIENTES']) {
    const ws = wb.worksheets.find(
      (w) => normalizeExcelHeader(w.name) === normalizeExcelHeader(name)
    );
    if (ws) preferred.push(ws);
  }
  wb.worksheets.forEach((w) => {
    if (!preferred.includes(w)) preferred.push(w);
  });

  let chosen = null;
  let headerInfo = null;
  for (const ws of preferred) {
    const info = findHeaderRow(ws);
    if (info) {
      chosen = ws;
      headerInfo = info;
      break;
    }
  }

  if (!chosen || !headerInfo) {
    console.error('NO_HEADER_ROW_FOUND');
    process.exit(2);
  }

  console.log('\nHoja elegida (misma lógica import):', chosen.name);
  console.log('Fila encabezados (1-based):', headerInfo.headerRowIdx1);

  const headerRow = chosen.getRow(headerInfo.headerRowIdx1);
  const maxCol = Math.max(headerRow.cellCount, chosen.actualColumnCount || 0, 40);

  // Sample first 3 data rows for examples
  const sampleRows = [];
  for (let r = headerInfo.headerRowIdx1 + 1; r <= headerInfo.headerRowIdx1 + 5; r += 1) {
    const row = chosen.getRow(r);
    const vals = {};
    let has = false;
    for (let c = 1; c <= maxCol; c += 1) {
      const v = cellDisplay(row.getCell(c).value);
      if (v) has = true;
      vals[c] = v;
    }
    if (has) sampleRows.push({ excelRow: r, vals });
    if (sampleRows.length >= 3) break;
  }

  console.log('\n| Columna | Encabezado | Color | Hex/Tema | Campo ARNALD | Ej. fila1 |');
  console.log('|---|---|---|---|---|---|');

  const report = [];
  for (let c = 1; c <= maxCol; c += 1) {
    const cell = headerRow.getCell(c);
    const text = cellDisplay(cell.value).trim();
    if (!text && !cell.fill) continue;
    const fillInfo = classifyFill(cell.fill);
    const field = HEADER_LOOKUP.get(normalizeExcelHeader(text)) || null;
    const ex = sampleRows[0]?.vals[c] || '';
    const letter = colLetter(c - 1);
    const ownerHint =
      fillInfo.label === 'Amarillo'
        ? 'ARNALD (amarillo)'
        : field
          ? 'Alfa (sugerido)'
          : 'Revisar';

    report.push({
      letter,
      col: c,
      header: text || `(vacío col ${letter})`,
      colorLabel: fillInfo.label,
      hex: fillInfo.hex,
      theme: fillInfo.theme,
      tint: fillInfo.tint,
      pattern: fillInfo.pattern,
      field,
      ownerHint,
      examples: sampleRows.map((s) => s.vals[c] || ''),
    });

    console.log(
      `| ${letter} | ${text || '—'} | ${fillInfo.label} | ${
        fillInfo.hex || (fillInfo.theme != null ? `theme:${fillInfo.theme}` : '—')
      } | ${field || '—'} | ${String(ex).slice(0, 40)} |`
    );
  }

  const yellow = report.filter((r) => r.colorLabel === 'Amarillo');
  const mapped = report.filter((r) => r.field);
  const unmapped = report.filter((r) => r.header && !r.field);

  console.log('\n=== RESUMEN ===');
  console.log('Total columnas con encabezado:', report.length);
  console.log('Mapeadas a SegurosAlfaCaso:', mapped.length);
  console.log('Sin mapear:', unmapped.map((u) => `${u.letter}:${u.header}`).join(' | ') || 'ninguna');
  console.log(
    'Amarillas:',
    yellow.map((y) => `${y.letter}:${y.header}→${y.field || '?'}`).join(' | ') || 'ninguna'
  );

  // Also dump raw fill JSON for yellow-ish / themed headers to refine detection
  console.log('\n=== FILL RAW (todas las columnas) ===');
  for (const r of report) {
    const cell = headerRow.getCell(r.col);
    console.log(
      JSON.stringify({
        col: r.letter,
        header: r.header,
        fill: cell.fill || null,
        fontColor: cell.font?.color || null,
      })
    );
  }

  // Count data rows roughly
  let dataCount = 0;
  for (let r = headerInfo.headerRowIdx1 + 1; r <= (chosen.rowCount || 0); r += 1) {
    const idCell = chosen.getRow(r).getCell(
      report.find((x) => x.field === 'identificacion')?.col || 1
    );
    if (cellDisplay(idCell.value)) dataCount += 1;
  }
  console.log('\nFilas con identificación (aprox):', dataCount);
  console.log('DONE');
}

main().catch((err) => {
  console.error('FATAL', err.message || err);
  process.exit(1);
});
