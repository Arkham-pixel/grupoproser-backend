/**
 * Repara casos Alfa corrupidos por filas Excel con columnas corridas
 * (póliza=día, crédito=CIUDAD, correo=teléfono), usando la fila buena del mismo Excel.
 *
 * Uso: node scripts/repairAlfaColumnShiftCorruption.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  resetMicrosoftGraphClient,
  getAccessToken,
  downloadDriveItemBuffer,
  getItemMetadata,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';
import { selectAlfaExcelFromSharePointFolder } from '../services/alfaExcelSharePointImportService.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import {
  parseAlfaExcelBuffer,
  looksLikeAlfaExcelColumnShiftCorruption,
} from '../services/alfaExcelImportService.js';
import { normalizeIdentification } from '../utils/alfaExcelNormalize.js';

function looksCorruptCaso(caso) {
  const cred = String(caso.numeroCredito || '').toUpperCase();
  const pol = String(caso.numeroPoliza || '').trim();
  const correo = String(caso.correo || '');
  if (cred === 'CALI') return true;
  if (/^\d{1,2}$/.test(pol) && /^\d{7,15}$/.test(correo)) return true;
  return false;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  resetMicrosoftGraphClient();
  await getAccessToken();

  const cfg = getAlfaExcelSharePointImportConfig();
  const { driveId } = await resolveDriveContext();
  const sel = await selectAlfaExcelFromSharePointFolder(cfg.rootPath, cfg.fileName);
  const meta = await getItemMetadata(sel.selected.itemId);
  const { buffer } = await downloadDriveItemBuffer({ driveId, itemId: meta.id });
  const parsed = parseAlfaExcelBuffer(buffer);

  const goodById = new Map();
  for (const r of parsed.rows) {
    const p = r.payload || {};
    const id = normalizeIdentification(p.identificacion);
    if (!id) continue;
    if (looksLikeAlfaExcelColumnShiftCorruption(p)) continue;
    const pol = String(p.numeroPoliza || '').trim();
    if (!pol || /^\d{1,2}$/.test(pol)) continue;
    if (!goodById.has(id)) goodById.set(id, p);
  }

  const all = await SegurosAlfaCaso.find({});
  let fixed = 0;
  let skipped = 0;
  let noGood = 0;

  for (const caso of all) {
    if (!looksCorruptCaso(caso)) {
      skipped += 1;
      continue;
    }
    const id = normalizeIdentification(caso.identificacion);
    const good = goodById.get(id);
    if (!good) {
      noGood += 1;
      console.log('NO_GOOD', caso.consecutivo, id);
      continue;
    }

    caso.numeroPoliza = good.numeroPoliza ?? caso.numeroPoliza;
    caso.numeroCredito = good.numeroCredito ?? caso.numeroCredito;
    caso.correo = good.correo ?? caso.correo;
    caso.informacionContacto =
      good.informacionContacto != null ? good.informacionContacto : null;
    if (good.direccionPredio) caso.direccionPredio = good.direccionPredio;
    if (good.ciudad) caso.ciudad = good.ciudad;
    if (good.departamento) caso.departamento = good.departamento;
    await caso.save();
    fixed += 1;
  }

  const stillCali = await SegurosAlfaCaso.countDocuments({ numeroCredito: /^CALI$/i });
  const sample = await SegurosAlfaCaso.findOne({ consecutivo: 'ALFA-2026-08-69' }).lean();
  console.log(
    JSON.stringify(
      {
        goodIds: goodById.size,
        fixed,
        skippedOk: skipped,
        noGood,
        stillCali,
        sample69: {
          poliza: sample?.numeroPoliza,
          credito: sample?.numeroCredito,
          correo: sample?.correo,
        },
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
