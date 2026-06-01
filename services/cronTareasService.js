import cron from 'node-cron';
import { AlertasTareasService } from './alertasTareasService.js';

// Servicio de cron para alertas automáticas de tareas
export class CronTareasService {
  
  static iniciarCronTareas() {
    try {
      console.log('🕐 Iniciando servicio de cron para alertas de tareas...');
      
      // Ejecutar cada día a las 9:00 AM
      const tareaCron = cron.schedule('0 9 * * *', async () => {
        try {
          console.log('🔄 Ejecutando alertas automáticas de tareas...');
          const resultado = await AlertasTareasService.procesarAlertasTareas();
          console.log('✅ Alertas de tareas procesadas:', resultado);
        } catch (error) {
          console.error('❌ Error ejecutando alertas automáticas de tareas:', error);
        }
      }, {
        scheduled: false, // No iniciar automáticamente
        timezone: "America/Bogota"
      });
      
      // Ejecutar cada 6 horas para alertas más frecuentes (opcional)
      const tareaCronFrecuente = cron.schedule('0 */6 * * *', async () => {
        try {
          console.log('🔄 Ejecutando verificación frecuente de alertas de tareas...');
          const resultado = await AlertasTareasService.procesarAlertasTareas();
          console.log('✅ Verificación frecuente completada:', resultado);
        } catch (error) {
          console.error('❌ Error en verificación frecuente de tareas:', error);
        }
      }, {
        scheduled: false, // No iniciar automáticamente
        timezone: "America/Bogota"
      });
      
      console.log('✅ Servicio de cron para tareas configurado correctamente');
      
      return {
        tareaCron,
        tareaCronFrecuente,
        iniciar: () => {
          console.log('▶️ Iniciando cron de alertas de tareas...');
          tareaCron.start();
          tareaCronFrecuente.start();
        },
        detener: () => {
          console.log('⏹️ Deteniendo cron de alertas de tareas...');
          tareaCron.stop();
          tareaCronFrecuente.stop();
        }
      };
      
    } catch (error) {
      console.error('❌ Error configurando cron de tareas:', error);
      throw error;
    }
  }
  
  // Función para ejecutar manualmente las alertas (para pruebas)
  static async ejecutarAlertasManual() {
    try {
      console.log('🧪 Ejecutando alertas de tareas manualmente...');
      const resultado = await AlertasTareasService.procesarAlertasTareas();
      console.log('✅ Alertas manuales ejecutadas:', resultado);
      return resultado;
    } catch (error) {
      console.error('❌ Error ejecutando alertas manuales:', error);
      throw error;
    }
  }
}
