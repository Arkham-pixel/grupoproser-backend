/**
 * Genera Excel FDM terremoto sin filas duplicadas (misma cédula / misma persona).
 * Deja SINIESTRO y AJUSTADOR vacíos para completar manualmente.
 *
 * Uso:
 *   node scripts/limpiarBaseTerremotoFdmExcel.js --file "C:/Users/.../BASE TERREMOTO.xlsx"
 */
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const norm = (h) =>
  String(h ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

function parseArgs() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  const file =
    fileIdx >= 0 && args[fileIdx + 1]
      ? path.resolve(args[fileIdx + 1])
      : path.resolve('C:/Users/GP-TI/Downloads/BASE TERREMOTO 10 DE AGOSTO.xlsx');
  const outIdx = args.indexOf('--out');
  const out =
    outIdx >= 0 && args[outIdx + 1]
      ? path.resolve(args[outIdx + 1])
      : path.resolve('C:/Users/GP-TI/Downloads/BASE_TERREMOTO_10_AGOSTO_LIMPIA_SIN_DUPLICADOS.xlsx');
  return { file, out };
}

function main() {
  const { file, out } = parseArgs();
  const wb = XLSX.readFile(file, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: '',
    raw: true,
  });
  const header = rows[0].map((h) => String(h ?? ''));
  const norms = header.map(norm);

  const idxNombre = norms.findIndex((h) => h === 'NOMBRE' || h.startsWith('NOMBRE '));
  const idxCedula = norms.findIndex(
    (h) => h === 'CEDULA' || h === 'IDENTIFICACION' || h.startsWith('CEDULA')
  );
  const idxSinExact = norms.findIndex((h) => h === 'SINIESTRO');
  const idxCaso = norms.findIndex((h) => h === 'CASO');

  const headerOut = [...header];
  const insertAt = idxSinExact >= 0 ? idxSinExact + 1 : idxCaso >= 0 ? idxCaso + 1 : header.length;
  headerOut.splice(insertAt, 0, 'AJUSTADOR');
  const idxAjustador = insertAt;
  const toNew = (i) => (i >= insertAt ? i + 1 : i);

  const seen = new Set();
  const kept = [];
  const removed = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const nom = String(row[idxNombre] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const cedRaw = String(row[idxCedula] ?? '').trim();
    const digits = cedRaw.replace(/[^0-9]/g, '');
    const hasData = row.some((c) => c !== '' && c != null);
    if (!hasData || (!nom && !cedRaw)) continue;

    const key = digits.length >= 5 ? `C:${digits}` : `N:${nom.toUpperCase()}`;
    if (seen.has(key)) {
      removed.push({ fila: i + 1, nombre: nom, cedula: cedRaw || '(sin cédula)' });
      continue;
    }
    seen.add(key);

    const outRow = new Array(headerOut.length).fill('');
    for (let j = 0; j < header.length; j += 1) {
      outRow[toNew(j)] = row[j] ?? '';
    }
    outRow[idxAjustador] = '';
    if (idxSinExact >= 0) outRow[toNew(idxSinExact)] = '';

    kept.push(outRow);
  }

  const outWb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headerOut, ...kept]);
  ws['!cols'] = headerOut.map((h) => ({
    wch: Math.min(32, Math.max(12, norm(h).length + 2)),
  }));
  XLSX.utils.book_append_sheet(outWb, ws, 'Base limpia');

  const wsDup = XLSX.utils.aoa_to_sheet([
    ['FILA_ORIGEN', 'NOMBRE', 'CEDULA'],
    ...removed.map((r) => [r.fila, r.nombre, r.cedula]),
  ]);
  XLSX.utils.book_append_sheet(outWb, wsDup, 'Duplicados quitados');

  XLSX.writeFile(outWb, out);

  console.log(
    JSON.stringify(
      {
        archivo: out,
        personasUnicas: kept.length,
        duplicadosQuitados: removed.length,
        columnaSiniestro: idxSinExact >= 0 ? toNew(idxSinExact) + 1 : null,
        columnaAjustador: idxAjustador + 1,
        nota: 'SINIESTRO y AJUSTADOR quedan vacíos para completar. Sube este archivo a SharePoint.',
      },
      null,
      2
    )
  );
}

main();
