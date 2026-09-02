import cron from 'node-cron';
import { emitirAvisosVisitaProximas } from './notificacionesVisitaAgendaService.js';

const CRON_SCHEDULE = process.env.NOTIF_VISITA_CRON || '* * * * *';
const ENABLED = process.env.NOTIF_VISITA_CRON_ENABLED !== 'false';

let task = null;

async function tickAvisosVisita() {
  try {
    const { creadas } = await emitirAvisosVisitaProximas();
    if (creadas > 0) {
      console.log(`📅 Avisos de visita: ${creadas} notificación(es)`);
    }
  } catch (error) {
    console.error('❌ Cron avisos de visita:', error.message);
  }
}

export function iniciarCronNotificacionesVisita() {
  if (!ENABLED) {
    console.log('⚠️ Cron de avisos de visita deshabilitado (NOTIF_VISITA_CRON_ENABLED=false)');
    return;
  }
  if (task) return;

  task = cron.schedule(CRON_SCHEDULE, tickAvisosVisita, {
    scheduled: true,
    timezone: 'America/Bogota',
  });
  tickAvisosVisita();

  console.log(`✅ Cron avisos de visita activo (${CRON_SCHEDULE}, 10–20 min antes, America/Bogota)`);
}

export function detenerCronNotificacionesVisita() {
  if (!task) return;
  task.stop();
  task.destroy();
  task = null;
}
