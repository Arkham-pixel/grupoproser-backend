/**
 * QA completo Alfa: montos planos vs liquidador (todos los casos con cifras).
 * Opcional Excel: --excel
 * Reparar + Excel: --fix  |  --fix --push-excel
 *
 * node scripts/qaAlfaMontosTodosVsLiquidador.js
 * node scripts/qaAlfaMontosTodosVsLiquidador.js --excel
 * node scripts/qaAlfaMontosTodosVsLiquidador.js --fix --push-excel
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';
import {
  liquidadorAlfaTieneCifras,
  aplicarMontosOficialesDesdeLiquidadorAlfa,
  extraerMontosLiquidadorAlfa,
} from '../utils/valoresLiquidadorAlfa.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import { downloadDriveItemBuffer } from '../services/microsoftGraphService.js';
import { findExcelRowForCase } from '../services/alfaExcelOutboundService.js';
import {
  enqueueAlfaExcelOutboundFromCaseUpdate,
  runAlfaExcelOutboundCycle,
} from '../services/alfaExcelOutboundService.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WITH_EXCEL = process.argv.includes('--excel') || process.argv.includes('--push-excel');
const DO_FIX = process.argv.includes('--fix');
const PUSH_EXCEL = process.argv.includes('--push-excel');

const CAMPOS = [
  'valorReclamado',
  'valorLiquidado',
  'liquidadoCoberturaTerremo',
  'deducibleTerremoto',
  'valorLiquidacionCoberturasAdicionales',
  'deducibleCoberturasAdicionales',
  'valorTotalPagar',
  'reserva',
];

function n(v) {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x) : null;
}

function moneyEq(a, b) {
  const za = n(a) == null ? 0 : n(a);
  const zb = n(b) == null ? 0 : n(b);
  return za === zb;
}

function diffsCampos(before, after) {
  const out = {};
  for (const f of CAMPOS) {
    if (moneyEq(before[f], after[f])) continue;
    out[f] = { before: n(before[f]), after: n(after[f]) };
  }
  return out;
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
  socketTimeoutMS: 180000,
});

let excelRows = [];
let src = null;
if (WITH_EXCEL) {
  src = await AlfaExcelSharePointSource.findOne({
    integrationKey: 'alfa-excel-control-seguimiento',
  }).lean();
  if (!src?.itemId || isAlfaExcelFinalProtectedName(src.fileName)) {
    console.error('ABORT excel source', src?.fileName);
    process.exit(1);
  }
  console.log('Descargando Excel…', src.fileName);
  const downloaded = await downloadDriveItemBuffer({
    driveId: src.driveId,
    itemId: src.itemId,
  });
  const parsed = parseAlfaExcelBuffer(downloaded.buffer || downloaded);
  excelRows = parsed.rows || [];
  console.log('Filas Excel:', excelRows.length);
}

const casos = await SegurosAlfaCaso.find({
  excluidoBaseAlfa: { $ne: true },
  liquidador: { $exists: true, $type: 'object' },
})
  .select(['_id', 'consecutivo', 'identificacion', 'asegurado', 'liquidador', ...CAMPOS].join(' '))
  .lean();

const resumen = {
  scanned: casos.length,
  conCifras: 0,
  sinCifras: 0,
  okMongoVsLiq: 0,
  diffMongoVsLiq: 0,
  okExcelVsLiq: 0,
  diffExcelVsLiq: 0,
  sinFilaExcel: 0,
  fixed: 0,
  enqueued: 0,
  samplesDiffMongo: [],
  samplesDiffExcel: [],
};

const diffsMongo = [];
const diffsExcel = [];

for (const caso of casos) {
  if (!liquidadorAlfaTieneCifras(caso.liquidador)) {
    resumen.sinCifras += 1;
    continue;
  }
  resumen.conCifras += 1;

  const oficial = extraerMontosLiquidadorAlfa(caso.liquidador, caso);
  const esperado = {
    valorReclamado: Math.round(Number(oficial.valorReclamado) || 0),
    valorLiquidado: Math.round(Number(oficial.valorLiquidado) || 0),
    liquidadoCoberturaTerremo: Math.round(Number(oficial.liquidadoCoberturaTerremo) || 0),
    deducibleTerremoto: Math.round(Number(oficial.deducibleTerremoto) || 0),
    valorLiquidacionCoberturasAdicionales: Math.round(
      Number(oficial.valorLiquidacionCoberturasAdicionales) || 0
    ),
    deducibleCoberturasAdicionales: Math.round(Number(oficial.deducibleCoberturasAdicionales) || 0),
    valorTotalPagar: Math.round(Number(oficial.valorTotalPagar) || 0),
    reserva: Math.round(Number(oficial.valorLiquidado) || 0),
  };

  const dMongo = diffsCampos(caso, esperado);
  if (Object.keys(dMongo).length) {
    resumen.diffMongoVsLiq += 1;
    const row = {
      consecutivo: caso.consecutivo,
      identificacion: caso.identificacion,
      asegurado: caso.asegurado,
      aiuPct: oficial.aiuPct,
      usaCotiz: oficial.usaCotiz,
      sid: oficial.sid,
      diffs: dMongo,
    };
    diffsMongo.push(row);
    if (resumen.samplesDiffMongo.length < 40) resumen.samplesDiffMongo.push(row);

    if (DO_FIX) {
      const sanado = aplicarMontosOficialesDesdeLiquidadorAlfa(caso);
      if (sanado.valorLiquidado != null) sanado.reserva = sanado.valorLiquidado;
      const patch = {};
      for (const f of CAMPOS) {
        if (sanado[f] == null) continue;
        if (moneyEq(caso[f], sanado[f])) continue;
        patch[f] = Math.round(Number(sanado[f]) || 0);
      }
      if (Object.keys(patch).length) {
        await SegurosAlfaCaso.updateOne(
          { _id: caso._id },
          { $set: { ...patch, updatedAt: new Date() } }
        );
        resumen.fixed += 1;
        if (PUSH_EXCEL) {
          const beforeDoc = { ...caso };
          for (const f of Object.keys(patch)) {
            beforeDoc[f] = Number(patch[f]) === 0 ? 1 : Number(patch[f]) + 1;
          }
          const out = await enqueueAlfaExcelOutboundFromCaseUpdate({
            beforeDoc,
            afterDoc: { ...caso, ...patch },
          });
          if (out) resumen.enqueued += 1;
        }
      }
    }
  } else {
    resumen.okMongoVsLiq += 1;
  }

  if (WITH_EXCEL) {
    let hit = null;
    try {
      hit = findExcelRowForCase(caso, excelRows);
    } catch (err) {
      if (err.code === 'EXCEL_ROW_NOT_FOUND' || err.code === 'AMBIGUOUS_EXCEL_ROW') {
        resumen.sinFilaExcel += 1;
      } else {
        throw err;
      }
      continue;
    }
    const excel = hit?.payload || {};
    const dExcel = diffsCampos(
      {
        valorReclamado: excel.valorReclamado,
        valorLiquidado: excel.valorLiquidado,
        liquidadoCoberturaTerremo: excel.liquidadoCoberturaTerremo,
        deducibleTerremoto: excel.deducibleTerremoto,
        valorLiquidacionCoberturasAdicionales: excel.valorLiquidacionCoberturasAdicionales,
        deducibleCoberturasAdicionales: excel.deducibleCoberturasAdicionales,
        valorTotalPagar: excel.valorTotalPagar,
        reserva: excel.reserva,
      },
      esperado
    );
    if (Object.keys(dExcel).length) {
      resumen.diffExcelVsLiq += 1;
      const row = {
        consecutivo: caso.consecutivo,
        identificacion: caso.identificacion,
        excelRow: hit.rowNumber,
        diffs: dExcel,
      };
      diffsExcel.push(row);
      if (resumen.samplesDiffExcel.length < 40) resumen.samplesDiffExcel.push(row);
    } else {
      resumen.okExcelVsLiq += 1;
    }
  }
}

if (DO_FIX && PUSH_EXCEL && resumen.enqueued > 0) {
  await AlfaExcelOutboundUpdate.updateMany(
    { status: { $in: ['processing', 'failed'] } },
    { $set: { status: 'pending', nextRetryAt: new Date(), attempts: 0 } }
  );
  let rounds = 0;
  let synced = 0;
  let failed = 0;
  while (rounds < 100) {
    const pending = await AlfaExcelOutboundUpdate.countDocuments({
      status: { $in: ['pending', 'processing'] },
      $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: new Date() } }],
    });
    if (!pending) break;
    rounds += 1;
    const summary = await runAlfaExcelOutboundCycle({ batchSize: 5 });
    for (const r of summary?.results || []) {
      if (r?.outcome === 'synced') synced += 1;
      if (r?.outcome === 'failed' || r?.outcome === 'dead') failed += 1;
    }
    console.log(JSON.stringify({ round: rounds, pendingBefore: pending, synced, failed }));
  }
  resumen.excelSync = {
    rounds,
    synced,
    failed,
    left: await AlfaExcelOutboundUpdate.countDocuments({
      status: { $in: ['pending', 'processing', 'failed'] },
    }),
  };
}

const outPath = path.join(__dirname, '_qa_alfa_montos_todos.json');
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      withExcel: WITH_EXCEL,
      fixed: DO_FIX,
      pushExcel: PUSH_EXCEL,
      fileName: src?.fileName || null,
      resumen,
      diffsMongo,
      diffsExcel,
    },
    null,
    2
  )
);

console.log(
  JSON.stringify(
    {
      resumen,
      informe: outPath,
      topDiffMongo: resumen.samplesDiffMongo.slice(0, 15),
      topDiffExcel: resumen.samplesDiffExcel.slice(0, 10),
    },
    null,
    2
  )
);

await mongoose.disconnect();
process.exit(resumen.diffMongoVsLiq > 0 && !DO_FIX ? 2 : 0);
