import 'dotenv/config';
import {
  resetMicrosoftGraphClient,
  getAccessToken,
  graphRequest,
  resolveDriveContext,
  getItemMetadata,
  downloadDriveItemBuffer,
} from '../services/microsoftGraphService.js';
import { selectAlfaExcelFromSharePointFolder } from '../services/alfaExcelSharePointImportService.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import {
  parseAlfaExcelBuffer,
  looksLikeAlfaExcelColumnShiftCorruption,
} from '../services/alfaExcelImportService.js';
import { normalizeIdentification } from '../utils/alfaExcelNormalize.js';
import * as XLSX from 'xlsx';
import fs from 'fs';

resetMicrosoftGraphClient();
await getAccessToken();
const cfg = getAlfaExcelSharePointImportConfig();
const { driveId } = await resolveDriveContext();
const sel = await selectAlfaExcelFromSharePointFolder(cfg.rootPath, cfg.fileName);
const meta = await getItemMetadata(sel.selected.itemId);
const versions = await graphRequest(
  `/drives/${driveId}/items/${meta.id}/versions?$top=25`
);
const list = (versions.value || []).map((v) => ({
  id: v.id,
  lastModified: v.lastModifiedDateTime,
  size: v.size,
}));
console.log(JSON.stringify(list, null, 2));

// Try oldest-ish recent version content
for (const v of list.slice(0, 8)) {
  try {
    const content = await graphRequest(
      `/drives/${driveId}/items/${meta.id}/versions/${v.id}/content`,
      { raw: true }
    );
    // graphRequest may not support raw - fallback
    console.log('version probe', v.id, typeof content);
  } catch (e) {
    console.log('version fail', v.id, e.message?.slice(0, 120));
  }
}
