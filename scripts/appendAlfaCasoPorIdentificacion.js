/**
 * Restaura/agrega al Excel operativo UNA fila Alfa que ya está en ARNALD.
 *   node scripts/appendAlfaCasoPorIdentificacion.js 38667607
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { syncMissingArnaldCasosToAlfaExcel } from '../services/alfaExcelOutboundService.js';

const id = String(process.argv[2] || '').trim();
if (!id) {
  console.error('Uso: node scripts/appendAlfaCasoPorIdentificacion.js <identificacion>');
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 25000,
});

const caso = await SegurosAlfaCaso.findOne({ identificacion: id })
  .select(
    'consecutivo identificacion asegurado estado excluidoBaseAlfa numeroPoliza ciudad'
  )
  .lean();
if (!caso) {
  console.error(JSON.stringify({ ok: false, error: 'Caso no está en operativa', id }));
  await mongoose.disconnect();
  process.exit(1);
}
if (caso.excluidoBaseAlfa === true) {
  console.error(JSON.stringify({ ok: false, error: 'Caso sigue excluido', caso }));
  await mongoose.disconnect();
  process.exit(1);
}

console.log(JSON.stringify({ event: 'CASO', caso }, null, 2));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let result = null;
let lastErr = null;
for (let attempt = 1; attempt <= 6; attempt += 1) {
  try {
    result = await syncMissingArnaldCasosToAlfaExcel({
      batchSize: 1,
      identificaciones: [id],
    });
    lastErr = null;
    break;
  } catch (e) {
    lastErr = e;
    console.warn(
      JSON.stringify({
        attempt,
        code: e.code,
        error: e.message,
      })
    );
    if (e.code !== 'EXCEL_SOURCE_LOCKED' && e.code !== 'EXCEL_SOURCE_ETAG_CHANGED') break;
    await sleep(20000);
  }
}

if (lastErr) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        code: lastErr.code,
        error: lastErr.message,
        hint:
          lastErr.code === 'EXCEL_SOURCE_LOCKED'
            ? 'El consolidado está abierto en Excel/SharePoint. El caso ya está en ARNALD; reintente el append al cerrarlo.'
            : undefined,
        caso,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}
await mongoose.disconnect();
