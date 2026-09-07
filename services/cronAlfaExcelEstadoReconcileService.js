/**
 * Cron: reconcilia estados de cierre ARNALD vs Excel Control y Seguimiento.
 * Reencola gaps (CERRADO/OBJETADO/DESISTIDO/LIQUIDADO desfasados).
 * SHAREPOINT_ALFA_EXCEL_ESTADO_RECONCILE_ENABLED (default = outbound enabled).
 */

import cron from 'node-cron';
import { getAlfaExcelOutboundConfig } from '../config/alfaExcelOutbound.js';
import { reconcileAlfaExcelEstadoGaps, syncMissingArnaldCasosToAlfaExcel } from './alfaExcelOutboundService.js';
import { isAlfaExcelOutboundCycleRunning } from '../workers/alfaExcelOutboundWorker.js';
import { isSharePointConfigured } from '../config/sharepoint.js';

let task = null;
let running = false;

export function iniciarCronAlfaExcelEstadoReconcile() {
  const cfg = getAlfaExcelOutboundConfig();

  if (!cfg.reconcileEnabled) {
    console.log(
      '⚠️ Cron Alfa Excel estado-reconcile deshabilitado (SHAREPOINT_ALFA_EXCEL_ESTADO_RECONCILE_ENABLED=false)'
    );
    return;
  }

  if (!isSharePointConfigured()) {
    console.log('⚠️ Cron Alfa Excel estado-reconcile omitido: MS_* no configurado');
    return;
  }

  if (task) return;

  if (!cron.validate(cfg.reconcileSchedule)) {
    console.error(
      `❌ SHAREPOINT_ALFA_EXCEL_ESTADO_RECONCILE_CRON inválido: ${cfg.reconcileSchedule}. Cron no iniciado.`
    );
    return;
  }

  task = cron.schedule(
    cfg.reconcileSchedule,
    async () => {
      if (running || isAlfaExcelOutboundCycleRunning()) {
        console.log(
          JSON.stringify({
            event: 'Alfa Excel estado-reconcile tick skipped',
            reason: running ? 'OVERLAPPING_RECONCILE' : 'OUTBOUND_CYCLE_RUNNING',
          })
        );
        return;
      }
      running = true;
      try {
        // 1) Filas ARNALD que aún no están en Excel
        let appendSummary = null;
        try {
          appendSummary = await syncMissingArnaldCasosToAlfaExcel({ batchSize: 80 });
          if (appendSummary?.appended > 0) {
            console.log(
              `➕ Alfa Excel append-missing: appended=${appendSummary.appended} rowsAfter=${appendSummary.excelRowsAfter} file=${appendSummary.fileName}`
            );
          }
        } catch (appendErr) {
          console.error('❌ Error append-missing Alfa Excel:', appendErr.message);
        }

        // 2) Estados de cierre desfasados
        const summary = await reconcileAlfaExcelEstadoGaps({ apply: true });
        if (summary.gaps > 0 || summary.enqueued > 0 || (appendSummary?.appended || 0) > 0) {
          console.log(
            `🔁 Alfa Excel estado-reconcile: gaps=${summary.gaps} enqueued=${summary.enqueued} missingRows=${summary.missingRows || 0} appended=${appendSummary?.appended || 0} file=${summary.fileName}`
          );
        }
      } catch (error) {
        console.error('❌ Error en cron Alfa Excel estado-reconcile:', error.message);
      } finally {
        running = false;
      }
    },
    { scheduled: true, timezone: 'America/Bogota' }
  );

  console.log(
    `✅ Cron Alfa Excel estado-reconcile activo (${cfg.reconcileSchedule}, America/Bogota)`
  );
}

export function detenerCronAlfaExcelEstadoReconcile() {
  if (task) {
    task.stop();
    task.destroy();
    task = null;
  }
  running = false;
}

export function isCronAlfaExcelEstadoReconcileActive() {
  return Boolean(task);
}

export function isAlfaExcelEstadoReconcileRunning() {
  return running;
}
