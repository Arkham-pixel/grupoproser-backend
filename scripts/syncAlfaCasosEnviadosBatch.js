/**
 * Sube casos listos a:
 *   SEGUROS ALFA/CASOS ENVIADOS A LA ASEGURADORA/{CEDULA}/{INFORMES|LIQUIDACION|FOTOS|GENERAL|…}
 *
 * Uso:
 *   node scripts/syncAlfaCasosEnviadosBatch.js
 *   node scripts/syncAlfaCasosEnviadosBatch.js --dry-run
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import ClaimDocument from '../models/ClaimDocument.js';
import { mapAlfaDocumentType } from '../config/alfaClaimDocumentMap.js';
import { getAlfaDocumentSubfolder } from '../utils/alfaDocumentPath.js';
import { syncClaimDocument } from '../services/claimDocumentSyncService.js';

const DESTINO = 'CASOS ENVIADOS A LA ASEGURADORA';

const CASOS = [
  { consecutivo: 'ALFA-2026-08-1533', cedula: '1144057937', nombre: 'DAVID JOSE TORRES PORTOCARRERO' },
];

const CONSECUTIVOS = CASOS.map((c) => c.consecutivo);
const DRY = process.argv.includes('--dry-run');

function sanitizeFileName(name) {
  return String(name || 'archivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.\-()+ ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function inferTypeFromArchivo(archivo, claim) {
  const name = String(claim?.originalName || archivo?.nombreOriginal || '').toUpperCase();
  // Nombre gana cuando deja clara la carpeta (evita GENERAL mal etiquetado)
  if (name.includes('FINIQUITO')) return 'liquidacion';
  if (name.includes('LIQUID') && !name.includes('INFORME')) return 'liquidacion';
  if (name.includes('INFORME')) return 'informe';
  if (/\.(JPG|JPEG|PNG|WEBP|HEIC|GIF)$/i.test(name)) return 'fotografia';

  const etiqueta = String(archivo?.etiqueta || '').trim().toUpperCase();
  if (etiqueta) {
    return mapAlfaDocumentType(etiqueta).documentType;
  }
  return claim?.documentType && claim.documentType !== 'otro'
    ? claim.documentType
    : 'general';
}

await mongoose.connect(process.env.MONGO_URI);
console.log(JSON.stringify({ event: 'START', dryRun: DRY, consecutivos: CONSECUTIVOS, destino: DESTINO }));

const casos = await SegurosAlfaCaso.find({ consecutivo: { $in: CONSECUTIVOS } })
  .select('consecutivo identificacion asegurado tomador archivos')
  .lean();

const missing = CONSECUTIVOS.filter((x) => !casos.some((c) => c.consecutivo === x));
if (missing.length) {
  console.error(JSON.stringify({ event: 'MISSING_CASOS', missing }));
  process.exitCode = 1;
}

const summary = [];

for (const caso of casos) {
  const expected = CASOS.find((c) => c.consecutivo === caso.consecutivo);
  const archivoByName = new Map(
    (caso.archivos || []).map((a) => [
      String(a.nombreOriginal || '').trim().toLowerCase(),
      a,
    ])
  );

  const claims = await ClaimDocument.find({
    sourceModule: 'alfa',
    claimId: caso._id,
    status: 'active',
  });

  console.log(
    JSON.stringify({
      event: 'CASO',
      consecutivo: caso.consecutivo,
      cedula: caso.identificacion,
      expectedCedula: expected?.cedula,
      idMatch: String(caso.identificacion) === String(expected?.cedula),
      asegurado: caso.asegurado || caso.tomador,
      claims: claims.length,
    })
  );

  const casoResult = {
    consecutivo: caso.consecutivo,
    cedula: caso.identificacion,
    synced: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const doc of claims) {
    const archivo =
      archivoByName.get(String(doc.originalName || '').trim().toLowerCase()) ||
      null;
    const nextType = inferTypeFromArchivo(archivo, doc);
    const subfolder = getAlfaDocumentSubfolder(nextType);
    const targetFolder = `SEGUROS ALFA/${DESTINO}/${caso.identificacion}/${subfolder}`;

    if (DRY) {
      console.log(
        JSON.stringify({
          event: 'DRY',
          consecutivo: caso.consecutivo,
          file: doc.originalName,
          fromType: doc.documentType,
          toType: nextType,
          target: `${targetFolder}/${doc.storedName || doc.originalName}`,
          wasEnabled: doc.sharepoint?.enabled,
          wasStatus: doc.sharepoint?.syncStatus,
        })
      );
      casoResult.skipped += 1;
      continue;
    }

    doc.documentType = nextType;
    doc.alfaIdentificacion = caso.identificacion || doc.alfaIdentificacion;
    doc.destinationStatus = 'ready';
    doc.destinationReason = undefined;
    const safeName = sanitizeFileName(doc.storedName || doc.originalName);
    if (safeName) doc.storedName = safeName;
    if (!doc.sharepoint) doc.sharepoint = {};
    doc.sharepoint.enabled = true;
    doc.sharepoint.syncStatus = 'pending';
    if (
      doc.sharepoint.itemId &&
      !String(doc.sharepoint.path || '').includes(DESTINO)
    ) {
      doc.sharepoint.itemId = undefined;
      doc.sharepoint.parentItemId = undefined;
      doc.sharepoint.path = undefined;
      doc.sharepoint.webUrl = undefined;
      doc.sharepoint.syncedAt = undefined;
    }
    doc.sharepoint.lastError = undefined;
    await doc.save();

    const result = await syncClaimDocument(doc._id, {
      destinationRoot: DESTINO,
    });

    const row = {
      file: doc.originalName,
      type: nextType,
      subfolder,
      result: result.result,
      path: result.document?.sharepoint?.path || result.syncResult?.sharepoint?.path,
      error: result.error?.code || result.error?.message,
    };
    casoResult.details.push(row);

    if (result.result === 'synced') casoResult.synced += 1;
    else if (result.result === 'failed' || result.result === 'ERROR') casoResult.failed += 1;
    else casoResult.skipped += 1;

    console.log(JSON.stringify({ event: 'DOC_DONE', consecutivo: caso.consecutivo, ...row }));
  }

  summary.push(casoResult);
}

console.log(JSON.stringify({ event: 'SUMMARY', dryRun: DRY, summary }, null, 2));
await mongoose.disconnect();
