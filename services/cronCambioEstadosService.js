import cron from 'node-cron';
import { getNextCronRun } from '../utils/cronNextRun.js';
import Siniestro from '../models/CasoComplex.js';
import Estado from '../models/Estado.js';

// Configuración del cron job
// Por defecto se ejecuta diariamente a las 2:00 AM (hora de Colombia)
const CRON_SCHEDULE = process.env.CAMBIO_ESTADOS_CRON_SCHEDULE || '0 2 * * *';
const ENABLE_CRON = process.env.ENABLE_CAMBIO_ESTADOS_CRON !== 'false';

class CronCambioEstadosService {
  constructor() {
    this.isRunning = false;
    this.lastExecution = null;
    this.nextExecution = null;
    this.task = null;
  }

  // Iniciar el servicio de cron
  start() {
    if (!ENABLE_CRON) {
      console.log('⚠️ Cron de cambio de estados deshabilitado por configuración');
      return;
    }

    if (this.isRunning) {
      console.log('⚠️ Cron de cambio de estados ya está ejecutándose');
      return;
    }

    try {
      console.log('🚀 Iniciando servicio de cron para cambio automático de estados...');
      console.log(`⏰ Programado para ejecutarse: ${CRON_SCHEDULE} (hora de Colombia)`);
      console.log(`📋 Cambiará casos FINALIZADOS a FACTURADO automáticamente`);
      
      // Programar la tarea
      this.task = cron.schedule(CRON_SCHEDULE, async () => {
        await this.cambiarEstadosFinalizadosAFacturado();
      }, {
        scheduled: true,
        timezone: "America/Bogota" // Zona horaria de Colombia
      });

      this.isRunning = true;
      this.calcularProximaEjecucion();
      
      console.log('✅ Servicio de cron de cambio de estados iniciado correctamente');
      console.log(`📅 Próxima ejecución: ${this.nextExecution}`);
      
    } catch (error) {
      console.error('❌ Error iniciando cron de cambio de estados:', error);
      this.isRunning = false;
    }
  }

  // Detener el servicio de cron
  stop() {
    if (!this.isRunning) {
      console.log('⚠️ Cron de cambio de estados no está ejecutándose');
      return;
    }

    try {
      console.log('🛑 Deteniendo servicio de cron de cambio de estados...');
      
      if (this.task) {
        this.task.stop();
        this.task.destroy();
        this.task = null;
      }
      
      this.isRunning = false;
      console.log('✅ Servicio de cron de cambio de estados detenido correctamente');
      
    } catch (error) {
      console.error('❌ Error deteniendo cron de cambio de estados:', error);
    }
  }

  // Función principal para cambiar estados de FINALIZADO a FACTURADO
  async cambiarEstadosFinalizadosAFacturado() {
    try {
      console.log('🔄 ===== INICIANDO CAMBIO AUTOMÁTICO DE ESTADOS =====');
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

      // Paso 1: Buscar el código del estado FINALIZADO
      console.log('🔍 Buscando código del estado FINALIZADO...');
      const estadoFinalizado = await Estado.findOne({
        $or: [
          { descEstdo: /FINALIZADO/i },
          { codiEstdo: 13 }
        ]
      });

      if (!estadoFinalizado) {
        console.log('⚠️ No se encontró el estado FINALIZADO en la base de datos');
        console.log('⚠️ Intentando con código 13 por defecto...');
      }

      const codigoFinalizado = estadoFinalizado ? String(estadoFinalizado.codiEstdo) : '13';
      console.log(`✅ Código FINALIZADO encontrado: ${codigoFinalizado}`);

      // Paso 2: Buscar el código del estado FACTURADO
      console.log('🔍 Buscando código del estado FACTURADO...');
      const estadoFacturado = await Estado.findOne({
        descEstdo: /FACTURADO/i
      });

      if (!estadoFacturado) {
        console.error('❌ ERROR: No se encontró el estado FACTURADO en la base de datos');
        console.error('❌ Por favor, verificar que el estado FACTURADO existe en la colección de estados');
        return {
          success: false,
          error: 'Estado FACTURADO no encontrado',
          casosActualizados: 0
        };
      }

      const codigoFacturado = String(estadoFacturado.codiEstdo);
      console.log(`✅ Código FACTURADO encontrado: ${codigoFacturado} (${estadoFacturado.descEstdo})`);

      // Paso 3: Buscar todos los casos con estado FINALIZADO
      // IMPORTANTE: Los estados pueden estar guardados como string o número
      console.log(`🔍 Buscando casos con estado FINALIZADO (código: ${codigoFinalizado})...`);
      const casosFinalizados = await Siniestro.find({
        $or: [
          { codiEstdo: codigoFinalizado },
          { codiEstdo: Number(codigoFinalizado) },
          { codiEstdo: String(codigoFinalizado) }
        ]
      });

      console.log(`📊 Casos FINALIZADOS encontrados: ${casosFinalizados.length}`);

      // Paso 3b: Buscar todos los casos SIN estado (null, vacío, o no existe)
      console.log(`🔍 Buscando casos SIN estado (null, vacío, o no existe)...`);
      const casosSinEstado = await Siniestro.find({
        $or: [
          { codiEstdo: null },
          { codiEstdo: '' },
          { codiEstdo: { $exists: false } }
        ]
      });

      console.log(`📊 Casos SIN estado encontrados: ${casosSinEstado.length}`);

      const totalCasos = casosFinalizados.length + casosSinEstado.length;

      if (totalCasos === 0) {
        console.log('✅ No hay casos para actualizar (ni FINALIZADOS ni sin estado)');
        this.lastExecution = new Date();
        return {
          success: true,
          casosActualizados: 0,
          casosFinalizados: 0,
          casosSinEstado: 0,
          mensaje: 'No hay casos para actualizar'
        };
      }

      // Paso 4: Actualizar todos los casos FINALIZADOS a FACTURADO
      // IMPORTANTE: Buscar tanto como string como número
      console.log(`🔄 Actualizando ${casosFinalizados.length} casos FINALIZADOS a estado FACTURADO...`);
      
      const resultadoFinalizados = await Siniestro.updateMany(
        {
          $or: [
            { codiEstdo: codigoFinalizado },
            { codiEstdo: Number(codigoFinalizado) },
            { codiEstdo: String(codigoFinalizado) }
          ]
        },
        { 
          $set: { 
            codiEstdo: codigoFacturado,
            descripcionEstado: estadoFacturado.descEstdo
          } 
        }
      );

      // Paso 5: Actualizar todos los casos SIN estado a FACTURADO
      console.log(`🔄 Actualizando ${casosSinEstado.length} casos SIN estado a estado FACTURADO...`);
      
      const resultadoSinEstado = await Siniestro.updateMany(
        {
          $or: [
            { codiEstdo: null },
            { codiEstdo: '' },
            { codiEstdo: { $exists: false } }
          ]
        },
        { 
          $set: { 
            codiEstdo: codigoFacturado,
            descripcionEstado: estadoFacturado.descEstdo
          } 
        }
      );

      const totalActualizados = resultadoFinalizados.modifiedCount + resultadoSinEstado.modifiedCount;
      const totalEncontrados = resultadoFinalizados.matchedCount + resultadoSinEstado.matchedCount;

      console.log('✅ ===== CAMBIO DE ESTADOS COMPLETADO =====');
      console.log(`✅ Casos FINALIZADOS actualizados: ${resultadoFinalizados.modifiedCount} de ${resultadoFinalizados.matchedCount}`);
      console.log(`✅ Casos SIN estado actualizados: ${resultadoSinEstado.modifiedCount} de ${resultadoSinEstado.matchedCount}`);
      console.log(`✅ Total actualizados: ${totalActualizados} de ${totalEncontrados}`);
      
      // Log detallado
      if (totalActualizados > 0) {
        console.log('📋 Casos FINALIZADOS actualizados (primeros 10):');
        casosFinalizados.slice(0, 10).forEach((caso, index) => {
          console.log(`   ${index + 1}. ${caso.nmroAjste || caso._id} - ${caso.nmroSinstro || 'Sin número'}`);
        });
        if (casosFinalizados.length > 10) {
          console.log(`   ... y ${casosFinalizados.length - 10} casos más`);
        }
        
        if (casosSinEstado.length > 0) {
          console.log('📋 Casos SIN estado actualizados (primeros 10):');
          casosSinEstado.slice(0, 10).forEach((caso, index) => {
            console.log(`   ${index + 1}. ${caso.nmroAjste || caso._id} - ${caso.nmroSinstro || 'Sin número'}`);
          });
          if (casosSinEstado.length > 10) {
            console.log(`   ... y ${casosSinEstado.length - 10} casos más`);
          }
        }
      }

      this.lastExecution = new Date();

      return {
        success: true,
        casosEncontrados: totalEncontrados,
        casosActualizados: totalActualizados,
        casosFinalizados: {
          encontrados: resultadoFinalizados.matchedCount,
          actualizados: resultadoFinalizados.modifiedCount
        },
        casosSinEstado: {
          encontrados: resultadoSinEstado.matchedCount,
          actualizados: resultadoSinEstado.modifiedCount
        },
        codigoFinalizado,
        codigoFacturado,
        fechaEjecucion: fechaColombia
      };

    } catch (error) {
      console.error('❌ Error ejecutando cambio automático de estados:', error);
      console.error('📋 Stack trace:', error.stack);
      this.lastExecution = new Date();
      return {
        success: false,
        error: error.message,
        casosActualizados: 0
      };
    }
  }

  // Ejecutar cambio de estados manualmente (para pruebas)
  async ejecutarCambioManual() {
    console.log('🔧 Ejecutando cambio de estados manualmente...');
    return await this.cambiarEstadosFinalizadosAFacturado();
  }

  // Calcular próxima ejecución
  calcularProximaEjecucion() {
    try {
      const now = new Date();
      this.nextExecution = getNextCronRun(CRON_SCHEDULE, 'America/Bogota');
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
}

// Crear instancia singleton
const cronCambioEstadosService = new CronCambioEstadosService();

// Función para iniciar el servicio
export const iniciarCronCambioEstados = () => {
  cronCambioEstadosService.start();
};

// Función para detener el servicio
export const detenerCronCambioEstados = () => {
  cronCambioEstadosService.stop();
};

// Función para ejecutar manualmente
export const ejecutarCambioEstadosManual = () => {
  return cronCambioEstadosService.ejecutarCambioManual();
};

// Función para obtener estado
export const obtenerEstadoCronCambioEstados = () => {
  return cronCambioEstadosService.getStatus();
};

// Exportar la instancia para uso directo
export default cronCambioEstadosService;

