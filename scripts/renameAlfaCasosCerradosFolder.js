/**
 * Renombra en SharePoint:
 *   SEGUROS ALFA/CASOS CERRADOS  →  SEGUROS ALFA/CASOS ENVIADOS A LA ASEGURADORA
 * y actualiza paths en ClaimDocument de los 3 casos.
 *
 *   node scripts/renameAlfaCasosCerradosFolder.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import ClaimDocument from '../models/ClaimDocument.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  getFolderByPath,
  graphRequest,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';

const OLD_NAME = 'CASOS CERRADOS';
const NEW_NAME = 'CASOS ENVIADOS A LA ASEGURADORA';
const OLD_PATH = `SEGUROS ALFA/${OLD_NAME}`;
const NEW_PATH = `SEGUROS ALFA/${NEW_NAME}`;

const CONSECUTIVOS = [
  'ALFA-2026-08-229',
  'ALFA-2026-08-106',
  'ALFA-2026-08-161',
];

const { driveId } = await resolveDriveContext();
console.log(JSON.stringify({ event: 'DRIVE', driveId }));

let folder;
try {
  folder = await getFolderByPath(OLD_PATH);
} catch (err) {
  console.log(
    JSON.stringify({
      event: 'OLD_FOLDER_LOOKUP',
      path: OLD_PATH,
      error: err.message,
      status: err.status,
    })
  );
}

if (folder?.id) {
  const renamed = await graphRequest(`/drives/${driveId}/items/${folder.id}`, {
    method: 'PATCH',
    body: { name: NEW_NAME },
  });
  console.log(
    JSON.stringify({
      event: 'RENAMED',
      id: renamed?.id,
      name: renamed?.name,
      webUrl: renamed?.webUrl,
    })
  );
} else {
  // Si ya no existe la vieja, verificar que la nueva esté
  try {
    const neu = await getFolderByPath(NEW_PATH);
    console.log(
      JSON.stringify({
        event: 'ALREADY_NEW',
        id: neu?.id,
        name: neu?.name,
        webUrl: neu?.webUrl,
      })
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'NEW_FOLDER_MISSING',
        path: NEW_PATH,
        error: err.message,
      })
    );
    process.exitCode = 1;
  }
}

await mongoose.connect(process.env.MONGO_URI);
const casos = await SegurosAlfaCaso.find({ consecutivo: { $in: CONSECUTIVOS } })
  .select('_id')
  .lean();
const ids = casos.map((c) => c._id);

const result = await ClaimDocument.updateMany(
  {
    sourceModule: 'alfa',
    claimId: { $in: ids },
    'sharepoint.path': { $regex: OLD_NAME },
  },
  [
    {
      $set: {
        'sharepoint.path': {
          $replaceAll: {
            input: '$sharepoint.path',
            find: OLD_NAME,
            replacement: NEW_NAME,
          },
        },
      },
    },
  ]
);

console.log(
  JSON.stringify({
    event: 'MONGO_PATHS_UPDATED',
    matched: result.matchedCount,
    modified: result.modifiedCount,
  })
);

await mongoose.disconnect();
