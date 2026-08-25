/**
 * Agrega al Excel operativo las filas de casos ARNALD que faltan (~1634 vs ~391).
 * Reintenta si SharePoint lo tiene bloqueado.
 * node scripts/appendMissingAlfaCasosToExcel.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import { syncMissingArnaldCasosToAlfaExcel } from '../services/alfaExcelOutboundService.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

await mongoose.connect(process.env.MONGO_URI);
console.log('Append filas faltantes → consolidado operativo…');

let result = null;
let lastErr = null;
for (let attempt = 1; attempt <= 8; attempt += 1) {
  try {
    result = await syncMissingArnaldCasosToAlfaExcel();
    lastErr = null;
    break;
  } catch (e) {
    lastErr = e;
    console.warn(
      JSON.stringify({
        attempt,
        code: e.code,
        error: e.message,
        retryInSec: e.code === 'EXCEL_SOURCE_LOCKED' ? 20 : 5,
      })
    );
    if (
      e.code !== 'EXCEL_SOURCE_LOCKED' &&
      e.code !== 'EXCEL_SOURCE_ETAG_CHANGED' &&
      !/ECONNRESET|ETIMEDOUT|socket hang up/i.test(String(e.message || ''))
    ) {
      break;
    }
    await sleep(
      e.code === 'EXCEL_SOURCE_LOCKED' || /ECONNRESET/i.test(String(e.message || ''))
        ? 25_000
        : 5_000
    );
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
            ? 'Cierre el consolidado en Excel Online/SharePoint y vuelva a intentar.'
            : undefined,
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
