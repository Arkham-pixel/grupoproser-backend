import cron from 'node-cron';
import cronParser from 'cron-parser';
import { enviarAlertasTodosAjustadores, obtenerAlertasTodosAjustadores } from './alertasService.js';

// Configuración del cron job
const CRON_SCHEDULE = process.env.ALERTAS_CRON_SCHEDULE || '0 9 * * *'; // 9:00 AM todos los días
// Por defecto, las alertas están habilitadas automáticamente
// Para deshabilitarlas, establecer ENABLE_ALERTAS_CRON=false en el .env
const ENABLE_CRON = process.env.ENABLE_ALERTAS_CRON !== 'false';

class CronAlertasService {
  constructor() {
    this.isRunning = false;
    this.lastExecution = null;
    this.nextExecution = null;
    this.task = null;
  }

  // Iniciar el servicio de cron
  start() {
    if (!ENABLE_CRON) {
      console.log('⚠️ Cron de alertas deshabilitado por configuración');
      return;
    }

    if (this.isRunning) {
      console.log('⚠️ Cron de alertas ya está ejecutándose');
      return;
    }

    try {
      console.log('🚀 Iniciando servicio de cron de alertas...');
      console.log(`⏰ Programado para ejecutarse: ${CRON_SCHEDULE} (hora de Colombia)`);
      console.log(`📅 IMPORTANTE: Solo casos agregados desde octubre 2025 recibirán alertas`);
      console.log(`📧 Las alertas se enviarán automáticamente por email a los ajustadores`);
      
      // Programar la tarea
      this.task = cron.schedule(CRON_SCHEDULE, async () => {
        await this.ejecutarAlertasAutomaticas();
      }, {
        scheduled: true,
        timezone: "America/Bogota" // Zona horaria de Colombia
      });

      this.isRunning = true;
      this.calcularProximaEjecucion();
      
      console.log('✅ Servicio de cron de alertas iniciado correctamente');
      console.log(`📅 Próxima ejecución: ${this.nextExecution}`);
      console.log(`🔄 El sistema enviará alertas automáticamente todos los días`);
      
    } catch (error) {
      console.error('❌ Error iniciando cron de alertas:', error);
      this.isRunning = false;
    }
  }

  // Detener el servicio de cron
  stop() {
    if (!this.isRunning) {
      console.log('⚠️ Cron de alertas no está ejecutándose');
      return;
    }

    try {
      console.log('🛑 Deteniendo servicio de cron de alertas...');
      
      if (this.task) {
        this.task.stop();
        this.task.destroy();
        this.task = null;
      }
      
      this.isRunning = false;
      console.log('✅ Servicio de cron de alertas detenido correctamente');
      
    } catch (error) {
      console.error('❌ Error deteniendo cron de alertas:', error);
    }
  }

  // Ejecutar alertas automáticas
  async ejecutarAlertasAutomaticas() {
    try {
      console.log('🚨 ===== EJECUTANDO ALERTAS AUTOMÁTICAS =====');
      // Obtener fecha y hora actual en zona horaria de Colombia
      const ahora = new Date();
      const fechaColombia = ahora.toLocaleString('es-CO', { 
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      console.log('⏰ Fecha y hora (Colombia):', fechaColombia);
      
      this.lastExecution = new Date();
      
      // Verificar si hay alertas antes de enviar
      const alertasGenerales = await obtenerAlertasTodosAjustadores();
      
      if (alertasGenerales.ajustadoresConAlertas === 0) {
        console.log('✅ No hay alertas pendientes, saltando envío automático');
        return;
      }
      
      console.log(`📊 Total de ajustadores con alertas: ${alertasGenerales.ajustadoresConAlertas}`);
      console.log(`📊 Total de alertas: ${alertasGenerales.resumenGeneral.totalAlertas}`);
      
      // Enviar alertas a todos los ajustadores
      const resultado = await enviarAlertasTodosAjustadores();
      
      console.log('✅ Alertas automáticas ejecutadas correctamente');
      console.log(`📧 Emails enviados: ${resultado.totalEnviados}`);
      console.log(`❌ Errores: ${resultado.totalErrores}`);
      
      // Log detallado de resultados
      if (resultado.resultados && resultado.resultados.length > 0) {
        console.log('📋 Detalle de resultados:');
        resultado.resultados.forEach(resultado => {
          const status = resultado.success ? '✅' : '❌';
          console.log(`  ${status} ${resultado.ajustador}: ${resultado.message}`);
        });
      }
      
      console.log('🚨 ===== FIN ALERTAS AUTOMÁTICAS =====');
      
    } catch (error) {
      console.error('❌ Error ejecutando alertas automáticas:', error);
      console.error('📋 Stack trace:', error.stack);
    }
  }

  // Ejecutar alertas manualmente (para pruebas)
  async ejecutarAlertasManual() {
    console.log('🔧 Ejecutando alertas manualmente...');
    await this.ejecutarAlertasAutomaticas();
  }

  // Calcular próxima ejecución
  calcularProximaEjecucion() {
    try {
      // Parsear el cron schedule para obtener la próxima ejecución
      const now = new Date();
      const interval = cronParser.parseExpression(CRON_SCHEDULE, { tz: 'America/Bogota' });
      this.nextExecution = interval.next().toDate();
    } catch (error) {
      console.error('❌ Error calculando próxima ejecución:', error);
      this.nextExecution = null;
    }
  }

  // Obtener estado del servicio
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastExecution: this.lastExecution,
      nextExecution: this.nextExecution,
      cronSchedule: CRON_SCHEDULE,
      enabled: ENABLE_CRON,
      timezone: 'America/Bogota'
    };
  }

  // Actualizar configuración del cron
  updateSchedule(newSchedule) {
    try {
      console.log(`🔄 Actualizando cron schedule de ${CRON_SCHEDULE} a ${newSchedule}`);
      
      // Detener tarea actual
      if (this.task) {
        this.task.stop();
        this.task.destroy();
      }
      
      // Crear nueva tarea con el nuevo schedule
      this.task = cron.schedule(newSchedule, async () => {
        await this.ejecutarAlertasAutomaticas();
      }, {
        scheduled: true,
        timezone: "America/Bogota"
      });
      
      // Actualizar configuración
      process.env.ALERTAS_CRON_SCHEDULE = newSchedule;
      this.calcularProximaEjecucion();
      
      console.log('✅ Cron schedule actualizado correctamente');
      console.log(`📅 Nueva próxima ejecución: ${this.nextExecution}`);
      
    } catch (error) {
      console.error('❌ Error actualizando cron schedule:', error);
      throw error;
    }
  }
}

// Crear instancia singleton
const cronAlertasService = new CronAlertasService();

// Función para iniciar el servicio
export const iniciarCronAlertas = () => {
  cronAlertasService.start();
};

// Función para detener el servicio
export const detenerCronAlertas = () => {
  cronAlertasService.stop();
};

// Función para ejecutar manualmente
export const ejecutarAlertasManual = () => {
  return cronAlertasService.ejecutarAlertasManual();
};

// Función para obtener estado
export const obtenerEstadoCronAlertas = () => {
  return cronAlertasService.getStatus();
};

// Función para actualizar schedule
export const actualizarScheduleCronAlertas = (newSchedule) => {
  return cronAlertasService.updateSchedule(newSchedule);
};

// Exportar la instancia para uso directo
export default cronAlertasService;
