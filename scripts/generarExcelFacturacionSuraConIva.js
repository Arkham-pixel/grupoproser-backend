/**
 * Genera Excel tipo Control Facturación + columna VALOR A PAGAR CON IVA
 * (honorarios + gastos de control_horas × 1.19). OBSERVACIONES en blanco.
 *
 *   node scripts/generarExcelFacturacionSuraConIva.js
 *   node scripts/generarExcelFacturacionSuraConIva.js --excel="C:/Users/.../archivo.xlsx"
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import os from 'os';

dotenv.config();

const IVA = 0.19;
const EXCEL_ARG = process.argv.find((a) => a.startsWith('--excel='));
const EXCEL_SRC =
  (EXCEL_ARG && EXCEL_ARG.slice('--excel='.length)) ||
  'C:/Users/GP-TI/Downloads/Contol Facturación - 24-09-2026 (3).xlsx';

function digits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function parseNum(v) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function totalesControl(ch) {
  const filas = Array.isArray(ch?.filas) ? ch.filas : [];
  let horas = 0;
  for (const f of filas) {
    horas +=
      parseNum(f.horas_viaje) +
      parseNum(f.horas_campo) +
      parseNum(f.horas_oficina) +
      parseNum(f.horas_secretaria);
  }
  const valorHora = parseNum(ch?.valor_hora) || 187400;
  const gastos = parseNum(ch?.gastos);
  const subtotal = horas * valorHora;
  const totalSinIva = subtotal + gastos;
  const totalConIva = Math.round(totalSinIva * (1 + IVA));
  return { horas, valorHora, gastos, subtotal, totalSinIva, totalConIva };
}

function leerPlantilla(ruta) {
  const wb = XLSX.readFile(ruta, { cellDates: true, raw: false });
  const sheet = wb.Sheets.Plantilla || wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils
    .sheet_to_json(sheet, { defval: '', raw: false })
    .map((r, i) => ({
      no: String(r['No.'] ?? r.No ?? i + 1).trim(),
      reclamacion: digits(r.RECLAMACION),
      informeFinal: String(r['INFORME FINAL'] || '').trim(),
      informeUnico: String(r['INFORME ÚNICO'] || r['INFORME UNICO'] || '').trim(),
    }))
    .filter((r) => r.reclamacion.length >= 10 && r.no.toUpperCase() !== 'TOTALES');
}

async function main() {
  const filasExcel = leerPlantilla(EXCEL_SRC);
  console.log('Casos plantilla:', filasExcel.length);

  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.collection('gsk3cAppsegurosSuraCasos');
  const recs = filasExcel.map((f) => f.reclamacion);
  const casos = await col
    .find({ siniestro: { $in: recs } })
    .project({
      siniestro: 1,
      consecutivo: 1,
      control_horas: 1,
      vlorServcios: 1,
      vlorGastos: 1,
    })
    .toArray();
  const bySin = new Map(casos.map((c) => [String(c.siniestro), c]));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GrupoProser';
  const ws = workbook.addWorksheet('Plantilla', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = [
    { header: 'No.', key: 'no', width: 8 },
    { header: 'RECLAMACION', key: 'reclamacion', width: 18 },
    { header: 'INFORME FINAL', key: 'informeFinal', width: 14 },
    { header: 'INFORME ÚNICO', key: 'informeUnico', width: 14 },
    { header: 'VALOR SIN IVA', key: 'valorSinIva', width: 18 },
    { header: 'VALOR A PAGAR CON IVA', key: 'valorConIva', width: 24 },
    { header: 'OBSERVACIONES', key: 'obs', width: 36 },
  ];

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFB91C1C' },
  };
  header.alignment = { vertical: 'middle', horizontal: 'center' };

  let sumaConIva = 0;
  let sumaSinIva = 0;
  const faltantes = [];

  filasExcel.forEach((fila, idx) => {
    const caso = bySin.get(fila.reclamacion);
    let valorConIva = 0;
    let valorSinIva = 0;
    if (!caso?.control_horas) {
      faltantes.push(fila.reclamacion);
    } else {
      const t = totalesControl(caso.control_horas);
      valorConIva = t.totalConIva;
      valorSinIva = Math.round(t.totalSinIva);
    }
    sumaConIva += valorConIva;
    sumaSinIva += valorSinIva;

    const row = ws.addRow({
      no: idx + 1,
      reclamacion: fila.reclamacion,
      informeFinal: fila.informeFinal === '1' ? '1' : '',
      informeUnico: fila.informeUnico === '1' ? '1' : '',
      valorSinIva,
      valorConIva,
      obs: '',
    });
    row.getCell('valorSinIva').numFmt = '"$"#,##0';
    row.getCell('valorConIva').numFmt = '"$"#,##0';
    row.getCell('informeFinal').alignment = { horizontal: 'center' };
    row.getCell('informeUnico').alignment = { horizontal: 'center' };
  });

  const tot = ws.addRow({
    no: 'TOTALES',
    reclamacion: '',
    informeFinal: filasExcel.filter((f) => f.informeFinal === '1').length,
    informeUnico: filasExcel.filter((f) => f.informeUnico === '1').length,
    valorSinIva: sumaSinIva,
    valorConIva: sumaConIva,
    obs: '',
  });
  tot.font = { bold: true };
  tot.getCell('valorSinIva').numFmt = '"$"#,##0';
  tot.getCell('valorConIva').numFmt = '"$"#,##0';

  // Hoja resumen
  const rs = workbook.addWorksheet('Resumen');
  rs.addRow(['Casos', filasExcel.length]);
  rs.addRow(['Subtotal honorarios (sin IVA)', sumaSinIva]);
  rs.addRow(['IVA 19%', Math.round(sumaConIva - sumaSinIva)]);
  rs.addRow(['Valor a pagar con IVA', sumaConIva]);
  rs.getColumn(1).width = 32;
  rs.getColumn(2).width = 18;
  rs.getColumn(2).numFmt = '"$"#,##0';

  const outDir = path.join(os.homedir(), 'Downloads');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const outPath = path.join(outDir, `Control Facturacion SURA con IVA - ${stamp}.xlsx`);
  await workbook.xlsx.writeFile(outPath);

  console.log(
    JSON.stringify(
      {
        outPath,
        casos: filasExcel.length,
        sumaSinIva,
        iva: Math.round(sumaConIva - sumaSinIva),
        sumaConIva,
        faltantes,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
