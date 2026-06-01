import cron from 'node-cron';
import { processEmailOutbox } from './emailOutboxService.js';

const CRON_SCHEDULE = process.env.EMAIL_OUTBOX_CRON || '*/5 * * * *';
const ENABLED = process.env.EMAIL_OUTBOX_CRON_ENABLED !== 'false';

let task = null;

export function iniciarCronEmailOutbox() {
  if (!ENABLED) {
    console.log('⚠️ Cron de cola de correos deshabilitado (EMAIL_OUTBOX_CRON_ENABLED=false)');
    return;
  }

  if (task) return;

  task = cron.schedule(
    CRON_SCHEDULE,
    async () => {
      try {
        const result = await processEmailOutbox();
        if (result.processed > 0) {
          console.log(
            `📬 Cola de correos: procesados=${result.processed} enviados=${result.sent} fallidos=${result.failed}`
          );
        }
      } catch (error) {
        console.error('❌ Error procesando cola de correos:', error.message);
      }
    },
    { scheduled: true, timezone: 'America/Bogota' }
  );

  console.log(`✅ Cron cola de correos activo (${CRON_SCHEDULE}, America/Bogota)`);
}

export function detenerCronEmailOutbox() {
  if (task) {
    task.stop();
    task.destroy();
    task = null;
  }
}
