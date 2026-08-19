/**
 * Busca una versión histórica del Excel Alfa con menos filas de columnas corridas.
 * Uso: node scripts/findCleanAlfaExcelVersion.js
 */
import 'dotenv/config';
import {
  resetMicrosoftGraphClient,
  getAccessToken,
  graphRequest,
  resolveDriveContext,
  getItemMetadata,
} from '../services/microsoftGraphService.js';
import { selectAlfaExcelFromSharePointFolder } from '../services/alfaExcelSharePointImportService.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import {
  parseAlfaExcelBuffer,
  looksLikeAlfaExcelColumnShiftCorruption,
} from '../services/alfaExcelImportService.js';
import { getSharePointConfig as getSpCfg } from '../config/sharepoint.js';

async function downloadVersionBuffer(driveId, itemId, versionId) {
  const cfg = getSpCfg();
  const token = await getAccessToken();
  const url = `${cfg.graphBaseUrl}/drives/${driveId}/items/${itemId}/versions/${versionId}/content`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`version ${versionId} HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function scoreBuffer(buffer) {
  const parsed = parseAlfaExcelBuffer(buffer);
  let bad = 0;
  let good = 0;
  for (const r of parsed.rows) {
    if (looksLikeAlfaExcelColumnShiftCorruption(r.payload || {})) bad += 1;
    else good += 1;
  }
  return { total: parsed.rows.length, good, bad };
}

resetMicrosoftGraphClient();
await getAccessToken();
const cfg = getAlfaExcelSharePointImportConfig();
const { driveId } = await resolveDriveContext();
const sel = await selectAlfaExcelFromSharePointFolder(cfg.rootPath, cfg.fileName);
const meta = await getItemMetadata(sel.selected.itemId);
const versions = await graphRequest(
  `/drives/${driveId}/items/${meta.id}/versions?$top=40`
);
const list = versions.value || [];

for (const v of list) {
  try {
    const buf = await downloadVersionBuffer(driveId, meta.id, v.id);
    const score = scoreBuffer(buf);
    console.log(
      JSON.stringify({
        id: v.id,
        lastModified: v.lastModifiedDateTime,
        size: v.size,
        ...score,
      })
    );
    if (score.bad < 10) {
      console.log('FOUND_CLEAN', v.id);
      break;
    }
  } catch (e) {
    console.log(JSON.stringify({ id: v.id, error: e.message }));
  }
}
