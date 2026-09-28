/**
 * Excel de casos Alfa corregidos en la pasada de montos/liquidador.
 * node scripts/exportAlfaCasosCorregidosExcel.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { extraerMontosLiquidadorAlfa, liquidadorAlfaTieneCifras } from '../utils/valoresLiquidadorAlfa.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Casos tocados en las reparaciones de esta sesión (deducible SID, AIU 0%, ×100, Excel). */
const CORREGIDOS = [
  {
    consecutivo: 'ALFA-2026-08-67',
    motivo: 'AIU 0% / montos alineados al liquidador',
  },
  { consecutivo: 'ALFA-2026-08-159', motivo: 'Excel desfasado → sincronizado desde liquidador' },
  { consecutivo: 'ALFA-2026-08-197', motivo: 'AIU 0% / montos (misma ID que 159 en Excel fila 303)' },
  { consecutivo: 'ALFA-2026-08-201', motivo: 'AIU 0% / montos alineados al liquidador' },
  { consecutivo: 'ALFA-2026-08-216', motivo: 'AIU 0% / montos alineados al liquidador' },
  { consecutivo: 'ALFA-2026-08-220', motivo: 'AIU 0% / montos alineados al liquidador' },
  { consecutivo: 'ALFA-2026-08-235', motivo: 'AIU 0% / montos alineados al liquidador' },
  { consecutivo: 'ALFA-2026-08-276', motivo: 'AIU 0% / deducible / montos' },
  { consecutivo: 'ALFA-2026-08-279', motivo: 'AIU 0% / montos alineados al liquidador' },
  { consecutivo: 'ALFA-2026-08-280', motivo: 'AIU 0% / montos alineados al liquidador' },
  { consecutivo: 'ALFA-2026-08-282', motivo: 'AIU 0% / deducible / montos' },
  { consecutivo: 'ALFA-2026-08-292', motivo: 'AIU 0% / montos alineados al liquidador' },
  { consecutivo: 'ALFA-2026-08-320', motivo: 'Excel desfasado → sincronizado desde liquidador' },
  { consecutivo: 'ALFA-2026-08-328', motivo: 'AIU 0% / montos alineados al liquidador' },
  { consecutivo: 'ALFA-2026-08-435', motivo: 'Excel desfasado → sincronizado desde liquidador' },
  { consecutivo: 'ALFA-2026-08-684', motivo: 'AIU 0% / montos alineados al liquidador' },
  { consecutivo: 'ALFA-2026-08-772', motivo: 'AIU 0% / montos alineados al liquidador' },
  { consecutivo: 'ALFA-2026-08-779', motivo: 'Excel desfasado → sincronizado desde liquidador' },
  {
    consecutivo: 'ALFA-2026-08-790',
    motivo: 'AIU 20% fantasma (×1.2) → AIU 0% del liquidador',
  },
  {
    consecutivo: 'ALFA-2026-08-839',
    motivo: 'SID ×2 (deducible duplicado) + AIU 20% fantasma → SID cotiz + AIU 0%',
  },
  {
    consecutivo: 'ALFA-2026-08-851',
    motivo: 'Cotización PDF ×100 (centavos pegados) corregida',
  },
  { consecutivo: 'ALFA-2026-08-1368', motivo: 'Excel desfasado → sincronizado desde liquidador' },
  {
    consecutivo: 'ALFA-2026-08-1579',
    motivo: 'Cotización PDF ×100 corregida + reserva/montos',
  },
  { consecutivo: 'ALFA-2026-08-1683', motivo: 'Excel: deducible vacío → sincronizado' },
  { consecutivo: 'ALFA-2026-08-1865', motivo: 'Reclamado = identificación → montos liquidador' },
  { consecutivo: 'ALFA-2026-08-1964', motivo: 'Excel desfasado → sincronizado desde liquidador' },
  {
    consecutivo: 'ALFA-2026-08-1977',
    motivo: 'Reclamado = identificación (1115069533) → valor liquidador',
  },
  { consecutivo: 'ALFA-2026-08-2027', motivo: 'Excel desfasado → sincronizado desde liquidador' },
  {
    consecutivo: 'ALFA-2026-08-2051',
    motivo: 'Cotización PDF ×100 (materiales) corregida',
  },
  { consecutivo: 'ALFA-2026-08-2175', motivo: 'Excel: reserva vacía → sincronizado' },
  { consecutivo: 'ALFA-2026-08-2230', motivo: 'AIU / deducible / montos alineados' },
  { consecutivo: 'ALFA-2026-08-2301', motivo: 'Reserva alineada al liquidador' },
];

const money = (v) => {
  if (v == null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const consecutivos = CORREGIDOS.map((c) => c.consecutivo);
const casos = await SegurosAlfaCaso.find({ consecutivo: { $in: consecutivos } })
  .select(
    [
      'consecutivo',
      'identificacion',
      'asegurado',
      'tomador',
      'numeroPoliza',
      'estado',
      'estadoGestion',
      'valorAseguradoSid',
      'valorReclamado',
      'valorLiquidado',
      'liquidadoCoberturaTerremo',
      'deducibleTerremoto',
      'valorLiquidacionCoberturasAdicionales',
      'deducibleCoberturasAdicionales',
      'valorTotalPagar',
      'reserva',
      'liquidador',
      'updatedAt',
    ].join(' ')
  )
  .lean();

const byCons = new Map(casos.map((c) => [c.consecutivo, c]));
const motivoBy = new Map(CORREGIDOS.map((c) => [c.consecutivo, c.motivo]));

const wb = new ExcelJS.Workbook();
wb.creator = 'GrupoProser ARNALD';
wb.created = new Date();
const ws = wb.addWorksheet('Casos corregidos', {
  views: [{ state: 'frozen', ySplit: 1 }],
});

const headers = [
  'CONSECUTIVO',
  'IDENTIFICACIÓN',
  'ASEGURADO',
  'TOMADOR',
  'PÓLIZA',
  'ESTADO',
  'ESTADO GESTIÓN',
  'MOTIVO CORRECCIÓN',
  'SID',
  'AIU %',
  'USA COTIZACIÓN',
  'VALOR RECLAMADO',
  'VALOR LIQUIDADO',
  'LIQUIDADO COBERTURA TERREMOTO',
  'DEDUCIBLE TERREMOTO',
  'VALOR LIQUIDACIÓN COBERTURAS ADICIONALES',
  'DEDUCIBLE COBERTURAS ADICIONALES',
  'VALOR TOTAL A PAGAR',
  'RESERVA',
  'ACTUALIZADO',
];

ws.addRow(headers);
ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
ws.getRow(1).fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F4E79' },
};
ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };

const moneyCols = [12, 13, 14, 15, 16, 17, 18, 19];

for (const meta of CORREGIDOS) {
  const c = byCons.get(meta.consecutivo);
  if (!c) {
    ws.addRow([
      meta.consecutivo,
      '',
      '',
      '',
      '',
      '',
      '',
      `${meta.motivo} (NO ENCONTRADO EN MONGO)`,
    ]);
    continue;
  }
  const tiene = liquidadorAlfaTieneCifras(c.liquidador);
  const calc = tiene ? extraerMontosLiquidadorAlfa(c.liquidador, c) : {};
  ws.addRow([
    c.consecutivo,
    c.identificacion || '',
    c.asegurado || '',
    c.tomador || '',
    c.numeroPoliza || '',
    c.estado || '',
    c.estadoGestion || '',
    motivoBy.get(c.consecutivo) || '',
    money(c.valorAseguradoSid ?? calc.sid),
    calc.aiuPct != null ? Math.round(Number(calc.aiuPct) * 10000) / 100 : '',
    calc.usaCotiz ? 'SÍ' : 'NO',
    money(c.valorReclamado),
    money(c.valorLiquidado),
    money(c.liquidadoCoberturaTerremo),
    money(c.deducibleTerremoto),
    money(c.valorLiquidacionCoberturasAdicionales),
    money(c.deducibleCoberturasAdicionales),
    money(c.valorTotalPagar),
    money(c.reserva),
    c.updatedAt ? new Date(c.updatedAt).toISOString() : '',
  ]);
}

for (const col of moneyCols) {
  ws.getColumn(col).numFmt = '"$"#,##0';
}
ws.getColumn(9).numFmt = '"$"#,##0';

ws.columns.forEach((col, idx) => {
  const widths = [18, 14, 32, 22, 14, 16, 16, 48, 16, 10, 12, 16, 16, 18, 16, 18, 14, 16, 16, 22];
  col.width = widths[idx] || 14;
});

const wsResumen = wb.addWorksheet('Resumen');
wsResumen.addRow(['Informe casos Alfa corregidos']);
wsResumen.getRow(1).font = { bold: true, size: 14 };
wsResumen.addRow(['Generado', new Date().toISOString()]);
wsResumen.addRow(['Total casos en listado', CORREGIDOS.length]);
wsResumen.addRow(['Encontrados en Mongo', casos.length]);
wsResumen.addRow([]);
wsResumen.addRow(['Incluye']);
wsResumen.addRow(['- SID duplicado / deducible inflado']);
wsResumen.addRow(['- AIU 20% fantasma con liquidador en 0%']);
wsResumen.addRow(['- Reclamado = número de identificación']);
wsResumen.addRow(['- Cotizaciones PDF con monto ×100']);
wsResumen.addRow(['- Excel desfasado vs liquidador (sincronizado)']);
wsResumen.getColumn(1).width = 55;
wsResumen.getColumn(2).width = 28;

const outDir = path.join(__dirname, '..', 'tmp');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const outPath = path.join(outDir, `alfa-casos-corregidos-${stamp}.xlsx`);
await wb.xlsx.writeFile(outPath);

console.log(
  JSON.stringify(
    {
      ok: true,
      path: outPath,
      total: CORREGIDOS.length,
      encontrados: casos.length,
    },
    null,
    2
  )
);

await mongoose.disconnect();
