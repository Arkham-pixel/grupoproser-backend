import cron from 'node-cron';
import { getEquidadFdmExcelSharePointConfig } from '../config/equidadFdmExcelSharePoint.js';
import {
  runEquidadFdmExcelSharePointWorkerCycle,
  isEquidadFdmExcelSharePointCycleRunning,
} from '../workers/equidadFdmExcelSharePointImportWorker.js';
import { isSharePointConfigured } from '../config/sharepoint.js';

let task = null;

export function iniciarCronEquidadFdmExcelSharePointImport() {
  const cfg = getEquidadFdmExcelSharePointConfig();

  if (!cfg.importCronEnabled) {
    console.log(
      '⚠️ Cron Equidad FDM Excel SharePoint deshabilitado (SHAREPOINT_EQUIDAD_FDM_EXCEL_IMPORT_ENABLED=false)'
    );
    return;
  }

  if (!isSharePointConfigured()) {
    console.log('⚠️ Cron Equidad FDM Excel SharePoint omitido: MS_* no configurado');
    return;
  }

  if (task) return;

  if (!cron.validate(cfg.importCronSchedule)) {
    console.error(
      `❌ SHAREPOINT_EQUIDAD_FDM_EXCEL_IMPORT_CRON inválido: ${cfg.importCronSchedule}`
    );
    return;
  }

  task = cron.schedule(
    cfg.importCronSchedule,
    async () => {
      if (isEquidadFdmExcelSharePointCycleRunning()) return;
      try {
        const summary = await runEquidadFdmExcelSharePointWorkerCycle();
        if (summary.outcome && summary.outcome !== 'SKIP_ALREADY_PREVIEWED') {
          console.log(
            `📊 Equidad FDM Excel SP: outcome=${summary.outcome} status=${summary.status} hasChanges=${summary.hasChanges}`
          );
        }
      } catch (error) {
        console.error('❌ Error en cron Equidad FDM Excel SharePoint:', error.message);
      }
    },
    { scheduled: true, timezone: 'America/Bogota' }
  );

  console.log(
    `✅ Cron Equidad FDM Excel SharePoint activo (${cfg.importCronSchedule}) — solo preview`
  );
}
