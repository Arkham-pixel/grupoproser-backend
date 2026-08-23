/**
 * Limpia documentación masiva bajo SEGUROS ALFA/SINIESTROS y deja solo
 * las 3 carpetas anteriores a la subida masiva (antes del 20-ago):
 *   - 88187559
 *   - 1112461634
 *   - 7184157
 *
 * También resetea ClaimDocument Alfa cuyo path apunta a carpetas borradas
 * (enabled=false, syncStatus=disabled) para que no se re-suban solos.
 *
 * Uso:
 *   node scripts/resetAlfaSiniestrosSharePointKeep3.js
 *   node scripts/resetAlfaSiniestrosSharePointKeep3.js --apply
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import { listFolder, deleteItem } from '../services/microsoftGraphService.js';
import ClaimDocument from '../models/ClaimDocument.js';

const APPLY = process.argv.includes('--apply');

/** Carpetas con anterioridad (antes de la subida masiva del 20-ago). */
const KEEP_FOLDERS = new Set(['88187559', '1112461634', '7184157']);

const ROOT = 'SEGUROS ALFA/SINIESTROS';

await mongoose.connect(process.env.MONGO_URI);

const listed = await listFolder(ROOT, { top: 200 });
const folders = (listed.children || []).filter((c) => c.folder);
const toKeep = folders.filter((f) => KEEP_FOLDERS.has(f.name));
const toDelete = folders.filter((f) => !KEEP_FOLDERS.has(f.name));

console.log(
  JSON.stringify(
    {
      dryRun: !APPLY,
      root: ROOT,
      keep: toKeep.map((f) => f.name),
      deleteCount: toDelete.length,
      deleteNames: toDelete.map((f) => f.name),
    },
    null,
    2
  )
);

const deleted = [];
const errors = [];

if (APPLY) {
  for (const folder of toDelete) {
    try {
      await deleteItem(folder.id);
      deleted.push(folder.name);
      console.log('DELETED', folder.name);
    } catch (e) {
      errors.push({ name: folder.name, error: e.message });
      console.error('FAIL', folder.name, e.message);
    }
  }
}

// Reset Mongo para docs cuyo path cae en carpetas borradas (o a borrar).
const keepPathRegex = new RegExp(
  `^${ROOT.replace(/\//g, '\\/')}\\/(${[...KEEP_FOLDERS].join('|')})(\\/|$)`
);

const mongoFilter = {
  sourceModule: 'alfa',
  status: { $ne: 'deleted' },
  'sharepoint.path': { $regex: `^${ROOT}/` },
  $nor: [{ 'sharepoint.path': { $regex: keepPathRegex.source } }],
};

const matched = await ClaimDocument.countDocuments(mongoFilter);
let mongoResult = { matched, modified: 0 };

if (APPLY && matched > 0) {
  mongoResult = await ClaimDocument.updateMany(mongoFilter, {
    $set: {
      'sharepoint.enabled': false,
      'sharepoint.syncStatus': 'disabled',
      'sharepoint.itemId': null,
      'sharepoint.webUrl': null,
      'sharepoint.path': null,
      'sharepoint.syncedAt': null,
      'sharepoint.nextRetryAt': null,
      'sharepoint.lastError': null,
      'sharepoint.attempts': 0,
    },
  });
}

console.log(
  JSON.stringify(
    {
      dryRun: !APPLY,
      sharePointDeleted: APPLY ? deleted.length : toDelete.length,
      sharePointErrors: errors,
      mongoMatched: matched,
      mongoModified: mongoResult.modifiedCount ?? mongoResult.nModified ?? 0,
      keptFolders: [...KEEP_FOLDERS],
      hint: APPLY
        ? 'Listo. Documentación reiniciada; las 3 carpetas históricas se conservaron.'
        : 'Dry-run. Ejecuta con --apply para borrar.',
    },
    null,
    2
  )
);

await mongoose.disconnect();
