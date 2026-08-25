import cron from 'node-cron';
import { espejarArchivosCatExistentesEnListado } from '../utils/espejarArchivoBbvaCatEnListado.js';

const CRON_SCHEDULE = process.env.BBVA_CAT_ESPEJO_CRON || '*/2 * * * *';
const ENABLED = process.env.BBVA_CAT_ESPEJO_CRON_ENABLED !== 'false';

let task = null;
let enCurso = false;

async function correrEspejo() {
  if (enCurso) return;
  enCurso = true;
  try {
    const resumen = await espejarArchivosCatExistentesEnListado();
    if (resumen.copiados > 0) {
      console.log(
        `📎 Espejo CAT→listado: copiados=${resumen.copiados} duplicados=${resumen.duplicados} sinListado=${resumen.sinListado}`
      );
    }
    if (resumen.errores?.length) {
      console.warn('⚠️ Espejo CAT→listado con errores:', resumen.errores.slice(0, 5));
    }
  } catch (error) {
    console.error('❌ Error en espejo CAT→listado:', error.message);
  } finally {
    enCurso = false;
  }
}

export function iniciarCronEspejoArchivosBbvaCat() {
  if (!ENABLED) {
    console.log('⚠️ Cron espejo archivos BBVA CAT deshabilitado (BBVA_CAT_ESPEJO_CRON_ENABLED=false)');
    return;
  }
  if (task) return;

  task = cron.schedule(
    CRON_SCHEDULE,
    () => {
      correrEspejo();
    },
    { scheduled: true, timezone: 'America/Bogota' }
  );

  correrEspejo();
  console.log(`✅ Cron espejo archivos BBVA CAT activo (${CRON_SCHEDULE}, America/Bogota)`);
}
