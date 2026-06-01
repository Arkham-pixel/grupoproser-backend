import Tarea from '../models/Tarea.js';
import { enviarAlertaTarea } from './emailService.js';

// Servicio de alertas automáticas para tareas
export class AlertasTareasService {
  
  // Función principal que se ejecuta cada 24 horas
  static async procesarAlertasTareas() {
    try {
      console.log('🔄 Iniciando procesamiento de alertas de tareas...');
      
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0); // Inicio del día
      
      // Obtener todas las tareas pendientes con alertas activas
      const tareasPendientes = await Tarea.find({
        cumplida: false,
        activarAlertas: true,
        emailResponsable: { $exists: true, $ne: null, $ne: '' }
      });
      
      console.log(`📋 Encontradas ${tareasPendientes.length} tareas pendientes para procesar`);
      
      let alertasEnviadas = 0;
      let alertasFinalesEnviadas = 0;
      
      for (const tarea of tareasPendientes) {
        const resultado = await this.procesarTareaIndividual(tarea, hoy);
        
        if (resultado.tipo === 'alerta_diaria') {
          alertasEnviadas++;
        } else if (resultado.tipo === 'alerta_final') {
          alertasFinalesEnviadas++;
        }
      }
      
      console.log(`✅ Procesamiento completado:`);
      console.log(`   📧 Alertas diarias enviadas: ${alertasEnviadas}`);
      console.log(`   ⚠️ Alertas finales enviadas: ${alertasFinalesEnviadas}`);
      
      return {
        success: true,
        tareasProcesadas: tareasPendientes.length,
        alertasEnviadas,
        alertasFinalesEnviadas
      };
      
    } catch (error) {
      console.error('❌ Error procesando alertas de tareas:', error);
      throw error;
    }
  }
  
  // Procesar una tarea individual
  static async procesarTareaIndividual(tarea, hoy) {
    try {
      const fechaLimite = new Date(tarea.fecha);
      fechaLimite.setHours(23, 59, 59, 999); // Final del día límite
      
      // Calcular días restantes
      const diasRestantes = Math.ceil((fechaLimite - hoy) / (1000 * 60 * 60 * 24));
      
      // Actualizar días restantes en la tarea
      await Tarea.findByIdAndUpdate(tarea._id, { diasRestantes });
      
      // Si ya pasó la fecha límite y no se ha enviado alerta final
      if (diasRestantes <= 0 && !tarea.alertaFinalEnviada) {
        return await this.enviarAlertaFinal(tarea);
      }
      
      // Si la tarea está en su día límite y no se ha enviado alerta final
      if (diasRestantes === 0 && !tarea.alertaFinalEnviada) {
        return await this.enviarAlertaFinal(tarea);
      }
      
      // Verificar si debe enviar alerta diaria
      if (diasRestantes > 0) {
        return await this.verificarAlertaDiaria(tarea, diasRestantes);
      }
      
      return { tipo: 'sin_alerta', motivo: 'No requiere alerta' };
      
    } catch (error) {
      console.error(`❌ Error procesando tarea ${tarea._id}:`, error);
      throw error;
    }
  }
  
  // Verificar si debe enviar alerta diaria
  static async verificarAlertaDiaria(tarea, diasRestantes) {
    try {
      const ahora = new Date();
      const ultimaAlerta = tarea.ultimaAlertaEnviada;
      
      // Si nunca se ha enviado alerta, enviar una
      if (!ultimaAlerta) {
        return await this.enviarAlertaDiaria(tarea, diasRestantes);
      }
      
      // Calcular horas desde la última alerta
      const horasDesdeUltimaAlerta = (ahora - ultimaAlerta) / (1000 * 60 * 60);
      
      // Enviar alerta si han pasado más de 20 horas (para dar margen)
      if (horasDesdeUltimaAlerta >= 20) {
        return await this.enviarAlertaDiaria(tarea, diasRestantes);
      }
      
      return { tipo: 'sin_alerta', motivo: 'Aún no es tiempo para nueva alerta' };
      
    } catch (error) {
      console.error(`❌ Error verificando alerta diaria para tarea ${tarea._id}:`, error);
      throw error;
    }
  }
  
  // Enviar alerta diaria
  static async enviarAlertaDiaria(tarea, diasRestantes) {
    try {
      console.log(`📧 Enviando alerta diaria para tarea: ${tarea.texto}`);
      
      const datosEmail = {
        numeroCaso: `TAREA-${tarea._id}`,
        nombreResponsable: tarea.login,
        emailResponsable: tarea.emailResponsable,
        aseguradora: 'Sistema de Tareas',
        asegurado: 'Usuario',
        fechaAsignacion: tarea.createdAt.toLocaleDateString(),
        quienAsigna: 'Sistema de Tareas',
        emailQuienAsigna: 'sistema@proserpuertos.com.co',
        observaciones: `Tarea pendiente: ${tarea.texto}`,
        tarea: {
          id: tarea._id,
          texto: tarea.texto,
          fecha: tarea.fecha,
          prioridad: tarea.prioridad,
          cumplida: tarea.cumplida,
          diasRestantes: diasRestantes,
          tipoAlerta: 'ALERTA_DIARIA'
        }
      };
      
      // Enviar email
      const resultado = await enviarAlertaTarea(datosEmail);
      
      // Actualizar última alerta enviada
      await Tarea.findByIdAndUpdate(tarea._id, {
        ultimaAlertaEnviada: new Date()
      });
      
      console.log(`✅ Alerta diaria enviada para tarea ${tarea._id}`);
      
      return {
        tipo: 'alerta_diaria',
        tareaId: tarea._id,
        diasRestantes,
        resultado
      };
      
    } catch (error) {
      console.error(`❌ Error enviando alerta diaria para tarea ${tarea._id}:`, error);
      throw error;
    }
  }
  
  // Enviar alerta final
  static async enviarAlertaFinal(tarea) {
    try {
      console.log(`⚠️ Enviando alerta final para tarea: ${tarea.texto}`);
      
      const datosEmail = {
        numeroCaso: `TAREA-${tarea._id}`,
        nombreResponsable: tarea.login,
        emailResponsable: tarea.emailResponsable,
        aseguradora: 'Sistema de Tareas',
        asegurado: 'Usuario',
        fechaAsignacion: tarea.createdAt.toLocaleDateString(),
        quienAsigna: 'Sistema de Tareas',
        emailQuienAsigna: 'sistema@proserpuertos.com.co',
        observaciones: `Tarea vencida: ${tarea.texto}`,
        tarea: {
          id: tarea._id,
          texto: tarea.texto,
          fecha: tarea.fecha,
          prioridad: tarea.prioridad,
          cumplida: tarea.cumplida,
          diasRestantes: 0,
          tipoAlerta: 'ALERTA_FINAL'
        }
      };
      
      // Enviar email
      const resultado = await enviarAlertaTarea(datosEmail);
      
      // Marcar que se envió la alerta final
      await Tarea.findByIdAndUpdate(tarea._id, {
        alertaFinalEnviada: true,
        ultimaAlertaEnviada: new Date()
      });
      
      console.log(`✅ Alerta final enviada para tarea ${tarea._id}`);
      
      return {
        tipo: 'alerta_final',
        tareaId: tarea._id,
        resultado
      };
      
    } catch (error) {
      console.error(`❌ Error enviando alerta final para tarea ${tarea._id}:`, error);
      throw error;
    }
  }
  
  // Función para obtener tareas que requieren alerta final
  static async obtenerTareasConAlertaFinal() {
    try {
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      
      const tareasConAlertaFinal = await Tarea.find({
        cumplida: false,
        activarAlertas: true,
        alertaFinalEnviada: true,
        emailResponsable: { $exists: true, $ne: null, $ne: '' }
      });
      
      return tareasConAlertaFinal;
      
    } catch (error) {
      console.error('❌ Error obteniendo tareas con alerta final:', error);
      throw error;
    }
  }
  
  // Función para desactivar alertas de una tarea
  static async desactivarAlertas(tareaId) {
    try {
      await Tarea.findByIdAndUpdate(tareaId, {
        activarAlertas: false
      });
      
      console.log(`✅ Alertas desactivadas para tarea ${tareaId}`);
      
      return { success: true, message: 'Alertas desactivadas correctamente' };
      
    } catch (error) {
      console.error(`❌ Error desactivando alertas para tarea ${tareaId}:`, error);
      throw error;
    }
  }
}
