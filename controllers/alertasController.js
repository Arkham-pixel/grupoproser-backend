import {
  obtenerAlertasAjustador,
  obtenerAlertasTodosAjustadores,
  enviarAlertasEmail,
  enviarAlertasTodosAjustadores,
  obtenerMisAlertasPorLogin,
  obtenerAlertasDeCaso,
} from '../services/alertasService.js';
import {
  obtenerProtocoloActivo,
  guardarProtocoloPersonalizado,
  restaurarProtocoloPorDefecto,
  obtenerHistorialProtocolo,
} from '../services/protocoloConfigService.js';
import { obtenerProtocoloPorDefecto } from '../config/protocoloSiniestrosDefaults.js';

// Obtener alertas de un ajustador específico
export const getAlertasAjustador = async (req, res) => {
  try {
    const { codigoResponsable } = req.params;
    
    if (!codigoResponsable) {
      return res.status(400).json({
        success: false,
        message: 'Código de responsable es requerido'
      });
    }

    console.log('🔍 Obteniendo alertas para ajustador:', codigoResponsable);
    
    const alertas = await obtenerAlertasAjustador(codigoResponsable);
    
    res.json({
      success: true,
      data: alertas
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo alertas del ajustador:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

// Obtener alertas de todos los ajustadores
export const getAlertasTodosAjustadores = async (req, res) => {
  try {
    console.log('🔍 Obteniendo alertas de todos los ajustadores...');
    
    const alertas = await obtenerAlertasTodosAjustadores();
    
    res.json({
      success: true,
      data: alertas
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo alertas de todos los ajustadores:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

// Enviar alertas por email a un ajustador específico
export const postEnviarAlertasEmail = async (req, res) => {
  try {
    const { codigoResponsable } = req.params;
    
    if (!codigoResponsable) {
      return res.status(400).json({
        success: false,
        message: 'Código de responsable es requerido'
      });
    }

    console.log('📧 Enviando alertas por email a:', codigoResponsable);
    
    const resultado = await enviarAlertasEmail(codigoResponsable);
    
    res.json({
      success: true,
      message: 'Alertas enviadas exitosamente',
      data: resultado
    });
    
  } catch (error) {
    console.error('❌ Error enviando alertas por email:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

// Enviar alertas por email a todos los ajustadores
export const postEnviarAlertasTodosAjustadores = async (req, res) => {
  try {
    console.log('📧 Enviando alertas a todos los ajustadores...');
    
    const resultado = await enviarAlertasTodosAjustadores();
    
    res.json({
      success: true,
      message: 'Proceso de envío de alertas completado',
      data: resultado
    });
    
  } catch (error) {
    console.error('❌ Error enviando alertas a todos los ajustadores:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

// Obtener resumen de alertas (para dashboard)
export const getResumenAlertas = async (req, res) => {
  try {
    console.log('📊 Obteniendo resumen de alertas...');
    
    const alertas = await obtenerAlertasTodosAjustadores();
    
    // Crear resumen simplificado para dashboard
    const resumen = {
      totalAjustadores: alertas.totalAjustadores,
      ajustadoresConAlertas: alertas.ajustadoresConAlertas,
      totalCasos: alertas.resumenGeneral.totalCasos,
      totalAlertas: alertas.resumenGeneral.totalAlertas,
      casosCriticos: alertas.resumenGeneral.casosCriticos,
      distribucionPrioridades: {
        alta: 0,
        media: 0,
        baja: 0
      },
      topAjustadores: alertas.ajustadores
        .sort((a, b) => b.casosConAlertas - a.casosConAlertas)
        .slice(0, 5)
        .map(a => ({
          codigo: a.ajustador,
          totalCasos: a.totalCasos,
          casosConAlertas: a.casosConAlertas,
          documentosObligatorios: a.resumen.documentosObligatorios,
          casosCriticos: a.resumen.casosCriticos
        }))
    };
    
    // Calcular distribución de prioridades
    alertas.ajustadores.forEach(ajustador => {
      ajustador.casos.forEach(caso => {
        caso.alertas.forEach(alerta => {
          if (alerta.prioridad === 'ALTA') resumen.distribucionPrioridades.alta++;
          else if (alerta.prioridad === 'MEDIA') resumen.distribucionPrioridades.media++;
          else resumen.distribucionPrioridades.baja++;
        });
      });
    });
    
    res.json({
      success: true,
      data: resumen
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo resumen de alertas:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

// Obtener alertas por prioridad
export const getAlertasPorPrioridad = async (req, res) => {
  try {
    const { prioridad } = req.params; // 'ALTA', 'MEDIA', 'BAJA'
    
    if (!prioridad || !['ALTA', 'MEDIA', 'BAJA'].includes(prioridad)) {
      return res.status(400).json({
        success: false,
        message: 'Prioridad debe ser ALTA, MEDIA o BAJA'
      });
    }

    console.log(`🔍 Obteniendo alertas con prioridad: ${prioridad}`);
    
    const alertas = await obtenerAlertasTodosAjustadores();
    
    // Filtrar alertas por prioridad
    const alertasFiltradas = [];
    
    alertas.ajustadores.forEach(ajustador => {
      ajustador.casos.forEach(caso => {
        const alertasPrioridad = caso.alertas.filter(alerta => alerta.prioridad === prioridad);
        if (alertasPrioridad.length > 0) {
          alertasFiltradas.push({
            ajustador: ajustador.ajustador,
            caso: {
              numeroAjuste: caso.numeroAjuste,
              numeroSiniestro: caso.numeroSiniestro,
              aseguradora: caso.aseguradora,
              asegurado: caso.asegurado,
              estado: caso.estado
            },
            alertas: alertasPrioridad
          });
        }
      });
    });
    
    res.json({
      success: true,
      data: {
        prioridad,
        totalAlertas: alertasFiltradas.length,
        alertas: alertasFiltradas
      }
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo alertas por prioridad:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

// Obtener alertas por tipo
export const getAlertasPorTipo = async (req, res) => {
  try {
    const { tipo } = req.params; // 'DOCUMENTO_OBLIGATORIO', 'INACTIVIDAD_CRITICA', etc.
    
    if (!tipo) {
      return res.status(400).json({
        success: false,
        message: 'Tipo de alerta es requerido'
      });
    }

    console.log(`🔍 Obteniendo alertas de tipo: ${tipo}`);
    
    const alertas = await obtenerAlertasTodosAjustadores();
    
    // Filtrar alertas por tipo
    const alertasFiltradas = [];
    
    alertas.ajustadores.forEach(ajustador => {
      ajustador.casos.forEach(caso => {
        const alertasTipo = caso.alertas.filter(alerta => alerta.tipo === tipo);
        if (alertasTipo.length > 0) {
          alertasFiltradas.push({
            ajustador: ajustador.ajustador,
            caso: {
              numeroAjuste: caso.numeroAjuste,
              numeroSiniestro: caso.numeroSiniestro,
              aseguradora: caso.aseguradora,
              asegurado: caso.asegurado,
              estado: caso.estado
            },
            alertas: alertasTipo
          });
        }
      });
    });
    
    res.json({
      success: true,
      data: {
        tipo,
        totalAlertas: alertasFiltradas.length,
        alertas: alertasFiltradas
      }
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo alertas por tipo:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

export const getProtocoloSiniestros = async (req, res) => {
  try {
    const protocolo = await obtenerProtocoloActivo();
    const defaults = obtenerProtocoloPorDefecto();
    res.json({
      success: true,
      data: {
        activo: protocolo,
        defaults,
      },
    });
  } catch (error) {
    console.error('❌ Error obteniendo protocolo:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
    });
  }
};

export const putProtocoloSiniestros = async (req, res) => {
  try {
    const usuario = req.usuario?.login || req.usuario?.nombre || 'admin';
    const protocolo = await guardarProtocoloPersonalizado(req.body, usuario);
    res.json({
      success: true,
      message: 'Protocolo actualizado correctamente',
      data: protocolo,
    });
  } catch (error) {
    console.error('❌ Error guardando protocolo:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
    });
  }
};

export const postRestaurarProtocoloSiniestros = async (req, res) => {
  try {
    const usuario = req.usuario?.login || req.usuario?.nombre || 'admin';
    const protocolo = await restaurarProtocoloPorDefecto(usuario);
    res.json({
      success: true,
      message: 'Protocolo restaurado a valores por defecto',
      data: protocolo,
    });
  } catch (error) {
    console.error('❌ Error restaurando protocolo:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
    });
  }
};

export const getMisAlertas = async (req, res) => {
  try {
    const login = req.query.login || req.usuario?.login || req.usuario?.cedula;
    const nombre = req.query.nombre || req.usuario?.name || req.usuario?.nombre;

    if (!login) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere login del usuario',
      });
    }

    const alertas = await obtenerMisAlertasPorLogin(login, nombre);
    res.json({ success: true, data: alertas });
  } catch (error) {
    console.error('❌ Error obteniendo mis alertas:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
    });
  }
};

export const getAlertasCaso = async (req, res) => {
  try {
    const { identificador } = req.params;
    if (!identificador) {
      return res.status(400).json({ success: false, message: 'Identificador requerido' });
    }

    const alertas = await obtenerAlertasDeCaso(identificador);
    if (!alertas) {
      return res.status(404).json({ success: false, message: 'Caso no encontrado' });
    }

    res.json({ success: true, data: alertas });
  } catch (error) {
    console.error('❌ Error obteniendo alertas del caso:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
    });
  }
};

export const getHistorialProtocolo = async (req, res) => {
  try {
    const limite = Math.min(parseInt(req.query.limite, 10) || 20, 50);
    const historial = await obtenerHistorialProtocolo(limite);
    res.json({ success: true, data: historial });
  } catch (error) {
    console.error('❌ Error obteniendo historial protocolo:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message,
    });
  }
};

