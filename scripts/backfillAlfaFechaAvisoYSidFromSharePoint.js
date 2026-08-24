/**
 * Rellena fechaAviso + valorAseguradoSid en ARNALD desde el Excel
 * de Control y Seguimiento en SharePoint (columnas A y N).
 *
 * Uso:
 *   node scripts/backfillAlfaFechaAvisoYSidFromSharePoint.js
 *   node scripts/backfillAlfaFechaAvisoYSidFromSharePoint.js --apply
 *   node scripts/backfillAlfaFechaAvisoYSidFromSharePoint.js --apply --limit=50
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import {
  resolveDriveContext,
  downloadDriveItemBuffer,
} from '../services/microsoftGraphService.js';
import { selectAlfaExcelFromSharePointFolder } from '../services/alfaExcelSharePointImportService.js';
import {
  parseAlfaExcelBuffer,
  matchAlfaCaseForExcelRow,
} from '../services/alfaExcelImportService.js';
import { updateAlfaCasoFields } from '../services/alfaCasoService.js';
import { valuesEqualForDiff } from '../utils/alfaExcelNormalize.js';
import { resetMicrosoftGraphClient } from '../services/microsoftGraphService.js';

const FIELDS = ['fechaAviso', 'valorAseguradoSid'];

function parseArgs(argv) {
  const out = { apply: false, limit: null };
  for (const a of argv) {
    if (a === '--apply') out.apply = true;
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8)) || null;
  }
  return out;
}

function hasValue(v) {
  if (v == null) return false;
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  return String(v).trim() !== '';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  resetMicrosoftGraphClient();
  await mongoose.connect(process.env.MONGO_URI);

  const cfg = getAlfaExcelSharePointImportConfig();
  console.log(
    JSON.stringify(
      {
        modo: args.apply ? 'APPLY' : 'DRY-RUN',
        path: cfg.rootPath,
        fileName: cfg.fileName || '(auto)',
        campos: FIELDS,
      },
      null,
      2
    )
  );

  const selection = await selectAlfaExcelFromSharePointFolder(cfg.rootPath, cfg.fileName);
  const meta = selection?.selected;
  const itemId = meta?.itemId || meta?.id;
  if (!itemId) {
    console.error('No se encontró el Excel Alfa en SharePoint.');
    console.log(JSON.stringify(selection, null, 2));
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const ctx = await resolveDriveContext(cfg.rootPath);
  const downloaded = await downloadDriveItemBuffer({
    driveId: ctx.driveId,
    itemId,
  });
  const buffer = downloaded?.buffer || downloaded;
  const parsed = parseAlfaExcelBuffer(buffer);
  const rows = parsed?.rows || [];

  const mapping = parsed?.mapping || {};
  console.log(
    JSON.stringify(
      {
        excel: meta.name,
        itemId,
        filas: rows.length,
        mappingSid: mapping.valorAseguradoSid ?? null,
        mappingAviso: mapping.fechaAviso ?? null,
      },
      null,
      2
    )
  );

  if (mapping.valorAseguradoSid == null && mapping.fechaAviso == null) {
    console.error(
      'El Excel no mapeó FECHA AVISO ni VALOR ASEGURADO SID. Revise encabezados de la hoja BD.'
    );
    process.exitCode = 2;
    await mongoose.disconnect();
    return;
  }

  const allCases = await SegurosAlfaCaso.find({}).lean();
  const resumen = {
    matched: 0,
    conSidExcel: 0,
    conAvisoExcel: 0,
    aActualizar: 0,
    actualizados: 0,
    sinMatch: 0,
    sample: [],
  };

  let processed = 0;
  for (const row of rows) {
    if (args.limit != null && processed >= args.limit) break;
    const payload = row.payload || {};
    const match = matchAlfaCaseForExcelRow(payload, allCases);
    if (!match?.cases?.length || match.cases.length !== 1) {
      if (hasValue(payload.valorAseguradoSid) || hasValue(payload.fechaAviso)) {
        resumen.sinMatch += 1;
      }
      continue;
    }
    resumen.matched += 1;
    processed += 1;

    const existing = match.cases[0];
    const patch = {};
    if (hasValue(payload.fechaAviso)) {
      resumen.conAvisoExcel += 1;
      if (!valuesEqualForDiff(payload.fechaAviso, existing.fechaAviso, 'fechaAviso')) {
        patch.fechaAviso = payload.fechaAviso;
      }
    }
    if (hasValue(payload.valorAseguradoSid)) {
      resumen.conSidExcel += 1;
      if (
        !valuesEqualForDiff(
          payload.valorAseguradoSid,
          existing.valorAseguradoSid,
          'valorAseguradoSid'
        )
      ) {
        patch.valorAseguradoSid = payload.valorAseguradoSid;
      }
    }

    if (!Object.keys(patch).length) continue;
    resumen.aActualizar += 1;
    if (resumen.sample.length < 8) {
      resumen.sample.push({
        consecutivo: existing.consecutivo,
        identificacion: existing.identificacion,
        patch,
      });
    }

    if (args.apply) {
      await updateAlfaCasoFields(existing._id, patch);
      resumen.actualizados += 1;
    }
  }

  console.log(JSON.stringify(resumen, null, 2));
  if (!args.apply) {
    console.log('\nDry-run. Para aplicar:');
    console.log('  node scripts/backfillAlfaFechaAvisoYSidFromSharePoint.js --apply');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
