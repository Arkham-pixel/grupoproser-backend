/**
 * QA: Mongo (liquidador oficial) vs Excel SharePoint — casos AIU 0%.
 * node scripts/qaAlfaAiu0MongoVsExcel.js
 * Escribe: scripts/_qa_alfa_aiu0_informe.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import {
  liquidadorAlfaTieneCifras,
  aplicarMontosOficialesDesdeLiquidadorAlfa,
  extraerMontosLiquidadorAlfa,
} from '../utils/valoresLiquidadorAlfa.js';
import { parseAlfaExcelBuffer } from '../services/alfaExcelImportService.js';
import { downloadDriveItemBuffer } from '../services/microsoftGraphService.js';
import { findExcelRowForCase } from '../services/alfaExcelOutboundService.js';
import { pesosOficialesAlfa, valuesEqualForDiff } from '../utils/alfaExcelNormalize.js';
import { isAlfaExcelFinalProtectedName } from '../utils/alfaExcelSharePointPath.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

/** Pesos: null/''/0 son equivalentes para control de liquidación. */
function moneyEq(a, b) {
  const na = n(a);
  const nb = n(b);
  const za = na == null ? 0 : na;
  const zb = nb == null ? 0 : nb;
  return za === zb;
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
  socketTimeoutMS: 180000,
});

const src = await AlfaExcelSharePointSource.findOne({
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
const excelRows = parsed.rows || [];
console.log('Filas Excel:', excelRows.length);

const casos = await SegurosAlfaCaso.find({
  excluidoBaseAlfa: { $ne: true },
  liquidador: { $exists: true, $type: 'object' },
  'liquidador.liquidacionCotizacionPdf.aiuPorcentaje': 0,
})
  .select(
    [
      '_id',
      'consecutivo',
      'identificacion',
      'asegurado',
      'estado',
      'liquidador',
      ...CAMPOS,
    ].join(' ')
  )
  .lean();

const filas = [];
let ok = 0;
let failMongo = 0;
let failExcel = 0;
let sinFila = 0;
let ambiguo = 0;
let sinCifras = 0;

for (const caso of casos) {
  if (!liquidadorAlfaTieneCifras(caso.liquidador)) {
    sinCifras += 1;
    filas.push({
      consecutivo: caso.consecutivo,
      identificacion: caso.identificacion,
      veredicto: 'SIN_CIFRAS_LIQUIDADOR',
      detalle: 'Liquidador sin montos usables',
    });
    continue;
  }

  const oficial = extraerMontosLiquidadorAlfa(caso.liquidador, caso);
  const sanear = (v) => {
    const p = pesosOficialesAlfa(v);
    return p != null ? Math.round(Number(p)) : Math.round(Number(v) || 0);
  };
  const esperado = {
    valorReclamado: sanear(oficial.valorReclamado),
    valorLiquidado: sanear(oficial.valorLiquidado),
    liquidadoCoberturaTerremo: sanear(oficial.liquidadoCoberturaTerremo),
    deducibleTerremoto: sanear(oficial.deducibleTerremoto),
    valorLiquidacionCoberturasAdicionales: sanear(
      oficial.valorLiquidacionCoberturasAdicionales
    ),
    deducibleCoberturasAdicionales: sanear(oficial.deducibleCoberturasAdicionales),
    valorTotalPagar: sanear(oficial.valorTotalPagar),
    reserva: sanear(oficial.valorLiquidado),
    aiuPct: oficial.aiuPct,
    aiu: oficial.aiu,
    subtotal: sanear(oficial.subtotal),
  };

  const mongoDiffs = [];
  for (const f of CAMPOS) {
    if (!moneyEq(caso[f], esperado[f])) {
      mongoDiffs.push({
        campo: f,
        mongo: n(caso[f]),
        esperado: esperado[f],
      });
    }
  }

  let excelHit = null;
  let excelError = null;
  try {
    excelHit = findExcelRowForCase(caso, excelRows);
  } catch (err) {
    excelError = err.code || err.message;
    if (err.code === 'EXCEL_ROW_NOT_FOUND') sinFila += 1;
    else if (err.code === 'AMBIGUOUS_EXCEL_ROW') ambiguo += 1;
  }

  const excelDiffs = [];
  let excelVals = null;
  if (excelHit?.payload) {
    excelVals = {};
    for (const f of CAMPOS) {
      excelVals[f] = n(excelHit.payload[f]);
      if (!moneyEq(excelHit.payload[f], esperado[f])) {
        excelDiffs.push({
          campo: f,
          excel: n(excelHit.payload[f]),
          esperado: esperado[f],
        });
      }
    }
  }

  let veredicto = 'OK';
  if (mongoDiffs.length) {
    veredicto = 'FALLA_MONGO';
    failMongo += 1;
  } else if (excelError === 'EXCEL_ROW_NOT_FOUND') {
    veredicto = 'SIN_FILA_EXCEL';
  } else if (excelError === 'AMBIGUOUS_EXCEL_ROW') {
    veredicto = 'AMBIGUO_EXCEL';
  } else if (excelDiffs.length) {
    veredicto = 'FALLA_EXCEL';
    failExcel += 1;
  } else if (!excelHit) {
    veredicto = 'ERROR_MATCH';
    if (excelError) failExcel += 1;
  } else {
    ok += 1;
  }

  filas.push({
    consecutivo: caso.consecutivo,
    identificacion: String(caso.identificacion || ''),
    asegurado: String(caso.asegurado || '').slice(0, 60),
    estado: caso.estado || '',
    excelRow: excelHit?.rowNumber ?? null,
    veredicto,
    esperado,
    mongo: Object.fromEntries(CAMPOS.map((f) => [f, n(caso[f])])),
    excel: excelVals,
    mongoDiffs,
    excelDiffs,
    excelError,
  });
}

const informe = {
  generadoEn: new Date().toISOString(),
  excel: {
    fileName: src.fileName,
    itemId: src.itemId,
    filas: excelRows.length,
  },
  criterio:
    'Universo: liquidador.liquidacionCotizacionPdf.aiuPorcentaje === 0. Esperado = recálculo liquidador (AIU 0% respetado). Compara Mongo y Excel.',
  resumen: {
    universo: casos.length,
    sinCifras,
    ok,
    fallaMongo: failMongo,
    fallaExcel: failExcel,
    sinFilaExcel: sinFila,
    ambiguoExcel: ambiguo,
    pctOkSobreConCifras:
      casos.length - sinCifras > 0
        ? Math.round((ok / (casos.length - sinCifras)) * 1000) / 10
        : null,
  },
  clave1144158482: filas.find((f) => f.identificacion === '1144158482') || null,
  fallas: filas.filter((f) => f.veredicto !== 'OK' && f.veredicto !== 'SIN_CIFRAS_LIQUIDADOR'),
  okSample: filas.filter((f) => f.veredicto === 'OK').slice(0, 15),
  todas: filas,
};

const outPath = path.join(__dirname, '_qa_alfa_aiu0_informe.json');
fs.writeFileSync(outPath, JSON.stringify(informe, null, 2), 'utf8');
console.log(JSON.stringify({ resumen: informe.resumen, outPath, clave: informe.clave1144158482?.veredicto }, null, 2));

await mongoose.disconnect();
