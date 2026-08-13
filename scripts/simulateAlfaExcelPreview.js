/**
 * Simulación PREVIEW incremental (NO execute) contra casos reales.
 * Uso: node scripts/simulateAlfaExcelPreview.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelImport from '../models/AlfaExcelImport.js';
import AlfaExcelImportRow from '../models/AlfaExcelImportRow.js';
import { previewAlfaExcelImport } from '../services/alfaExcelImportService.js';
import { isPolicyPlaceholder } from '../utils/alfaExcelNormalize.js';

function buildExcelFromCases(cases, { fillSiniestro = false, replacePlaceholderPoliza = false } = {}) {
  const headers = [
    'IDENTIFICACION',
    'ASEGURADO',
    'NÚMERO PÓLIZA',
    'SINIESTRO',
    'CORREO',
    'ESTADO',
    'N CREDITO',
    'DIRECCION PREDIO',
    'FECHA SINIESTRO',
  ];
  const rows = cases.map((c, i) => {
    let pol = c.numeroPoliza || '';
    if (replacePlaceholderPoliza && isPolicyPlaceholder(pol)) {
      pol = `INC-SIM-${String(c.identificacion).slice(-4)}-${i + 1}`;
    }
    let sin = c.siniestro || '';
    if (fillSiniestro && !sin) {
      sin = `SIM-SIN-${1000 + i}`;
    }
    const fecha =
      c.fechaSiniestro instanceof Date
        ? c.fechaSiniestro.toISOString().slice(0, 10)
        : c.fechaSiniestro || '';
    return [
      c.identificacion,
      c.asegurado || '',
      pol,
      sin,
      c.correo || '',
      c.estado || 'PENDIENTE',
      c.numeroCredito || '',
      c.direccionPredio || '',
      fecha,
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BD');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function cleanupPreview(ids) {
  if (!ids.length) return;
  await AlfaExcelImportRow.deleteMany({ importId: { $in: ids } });
  await AlfaExcelImport.deleteMany({ _id: { $in: ids } });
}

await mongoose.connect(process.env.MONGO_URI);
const cases = await SegurosAlfaCaso.find().lean();
const previewIds = [];

console.log('=== Simulación PREVIEW (sin execute) ===');
console.log(`Casos en Mongo: ${cases.length}`);
console.log(
  `Sin siniestro: ${cases.filter((c) => !c.siniestro).length} | Póliza placeholder: ${cases.filter((c) => isPolicyPlaceholder(c.numeroPoliza)).length}`
);

try {
  // 1) Excel espejo → mayormente UNCHANGED
  const bufSame = buildExcelFromCases(cases);
  const p1 = await previewAlfaExcelImport({
    buffer: bufSame,
    fileName: 'sim-espejo.xlsx',
    user: { login: 'simulate' },
  });
  previewIds.push(p1.importSessionId);
  console.log('\n--- Preview A: Excel espejo de BD actual ---');
  console.log(
    JSON.stringify(
      {
        created: p1.created,
        updated: p1.updated,
        unchanged: p1.unchanged,
        rejected: p1.rejected,
        ambiguous: p1.ambiguous,
        insights: p1.insights,
      },
      null,
      2
    )
  );
  console.log('Ejemplos representativos:');
  console.log(JSON.stringify(p1.examples?.representative?.slice(0, 5), null, 2));

  // 2) Excel con siniestros nuevos
  const bufSin = buildExcelFromCases(cases, { fillSiniestro: true });
  const p2 = await previewAlfaExcelImport({
    buffer: bufSin,
    fileName: 'sim-siniestros.xlsx',
    user: { login: 'simulate' },
  });
  previewIds.push(p2.importSessionId);
  console.log('\n--- Preview B: mismos casos + siniestro informado ---');
  console.log(
    JSON.stringify(
      {
        created: p2.created,
        updated: p2.updated,
        unchanged: p2.unchanged,
        rejected: p2.rejected,
        ambiguous: p2.ambiguous,
        claimNumberAssignments: p2.insights?.claimNumberAssignments,
      },
      null,
      2
    )
  );
  console.log('Casos que recibirían siniestro (muestra):');
  console.log(JSON.stringify(p2.examples?.claimNumberAssignments?.slice(0, 8), null, 2));

  // 3) Placeholder póliza → real + siniestro
  const bufPol = buildExcelFromCases(cases, {
    fillSiniestro: true,
    replacePlaceholderPoliza: true,
  });
  const p3 = await previewAlfaExcelImport({
    buffer: bufPol,
    fileName: 'sim-poliza-real.xlsx',
    user: { login: 'simulate' },
  });
  previewIds.push(p3.importSessionId);
  console.log('\n--- Preview C: placeholder póliza → real (+ siniestro) ---');
  console.log(
    JSON.stringify(
      {
        created: p3.created,
        updated: p3.updated,
        unchanged: p3.unchanged,
        rejected: p3.rejected,
        ambiguous: p3.ambiguous,
        policyPlaceholderToReal: p3.insights?.policyPlaceholderToReal,
        claimNumberAssignments: p3.insights?.claimNumberAssignments,
      },
      null,
      2
    )
  );
  console.log('Placeholder → real (muestra):');
  console.log(JSON.stringify(p3.examples?.policyPlaceholderToReal?.slice(0, 8), null, 2));

  console.log('\n*** NO se ejecutó /execute. Casos Alfa intactos. ***');
} finally {
  await cleanupPreview(previewIds);
  await mongoose.disconnect();
}
