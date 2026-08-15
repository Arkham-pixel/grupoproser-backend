import cron from 'node-cron';
import { getEquidadFdmExcelSharePointConfig } from '../config/equidadFdmExcelSharePoint.js';
import {
  runEquidadFdmExcelOutboundWorkerCycle,
  isEquidadFdmExcelOutboundCycleRunning,
} from '../workers/equidadFdmExcelOutboundWorker.js';
import { isSharePointConfigured } from '../config/sharepoint.js';

let task = null;

export function iniciarCronEquidadFdmExcelOutbound() {
  const cfg = getEquidadFdmExcelSharePointConfig();

  if (!cfg.outboundCronEnabled) {
    console.log(
      '⚠️ Cron Equidad FDM Excel outbound deshabilitado (SHAREPOINT_EQUIDAD_FDM_EXCEL_OUTBOUND_ENABLED=false)'
    );
    return;
  }

  if (!isSharePointConfigured()) {
    console.log('⚠️ Cron Equidad FDM Excel outbound omitido: MS_* no configurado');
    return;
  }

  if (task) return;

  if (!cron.validate(cfg.outboundCronSchedule)) {
    console.error(
      `❌ SHAREPOINT_EQUIDAD_FDM_EXCEL_OUTBOUND_CRON inválido: ${cfg.outboundCronSchedule}`
    );
    return;
  }

  task = cron.schedule(
    cfg.outboundCronSchedule,
    async () => {
      if (isEquidadFdmExcelOutboundCycleRunning()) return;
      try {
        const summary = await runEquidadFdmExcelOutboundWorkerCycle();
        if (summary.processed > 0) {
          console.log(
            `📤 Equidad FDM Excel outbound: processed=${summary.processed} synced=${summary.synced} errors=${summary.errors}`
          );
        }
      } catch (error) {
        console.error('❌ Error en cron Equidad FDM Excel outbound:', error.message);
      }
    },
    { scheduled: true, timezone: 'America/Bogota' }
  );

  console.log(
    `✅ Cron Equidad FDM Excel outbound activo (${cfg.outboundCronSchedule})`
  );
}
