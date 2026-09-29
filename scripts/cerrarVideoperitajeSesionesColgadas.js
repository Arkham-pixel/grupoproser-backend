/**
 * Legacy manual: el cierre obligatorio por duración vive en videoperitaje-sdk.
 * Este script solo sincroniza Mongo si el SDK ya cerró (vía webhook es el camino normal).
 *
 * Preferir desplegar el SDK con AUTO_CIERRE_ENABLED=1.
 */
import '../config/loadEnv.js';
console.log(
  [
    'El auto-cierre (> duracion_max_minutos) está en videoperitaje-sdk.',
    'Config SDK: AUTO_CIERRE_ENABLED=1',
    'Webhook Arnald: ARNALD_CIERRE_WEBHOOK_URL=.../api/videoperitaje/hooks/sdk-cierre',
    'Script fantasmas puntual: node scripts/cerrarFantasmasVideoperitajePostgres.js',
  ].join('\n')
);
process.exit(0);
