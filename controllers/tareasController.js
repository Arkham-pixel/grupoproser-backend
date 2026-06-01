import Tarea from '../models/Tarea.js';
import SecurUser from '../models/SecurUser.js';
import { enviarAlertaTarea } from '../services/emailService.js';

// Listar tareas por login
export const getTareas = async (req, res) => {
  try {
    const { login } = req.query;
    if (!login) {
      return res.status(400).json({ 
        success: false,
        mensaje: 'Falta el parámetro login' 
      });
    }

    const tareas = await Tarea.find({ login }).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: tareas
    });
  } catch (error) {
    console.error('❌ Error obteniendo tareas:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error interno del servidor',
      error: error.message
    });
  }
};

// Crear tarea
export const crearTarea = async (req, res) => {
  try {
    const { login, texto, fecha, prioridad = 'MEDIA', emailResponsable } = req.body;
    
    if (!login || !texto || !fecha) {
      return res.status(400).json({ 
        success: false,
        mensaje: 'Faltan campos requeridos: login, texto, fecha' 
      });
    }

    // Obtener el email del usuario desde la base de datos si no se proporciona
    let emailFinal = emailResponsable;
    if (!emailFinal) {
      try {
        const usuario = await SecurUser.findOne({ login });
        if (usuario && usuario.email) {
          emailFinal = usuario.email;
          console.log(`📧 Email obtenido automáticamente para ${login}: ${emailFinal}`);
        } else {
          // Si no se encuentra en SecurUser, usar un email por defecto
          emailFinal = 'danalyst@proserpuertos.com.co';
          console.log(`⚠️ Usuario ${login} no encontrado en SecurUser, usando email por defecto: ${emailFinal}`);
        }
      } catch (error) {
        console.error('❌ Error obteniendo email del usuario:', error);
        // En caso de error, usar email por defecto
        emailFinal = 'danalyst@proserpuertos.com.co';
        console.log(`⚠️ Error obteniendo email, usando email por defecto: ${emailFinal}`);
      }
    }

    const tarea = new Tarea({ 
      login, 
      texto, 
      fecha: new Date(fecha),
      prioridad,
      emailResponsable: emailFinal
    });
    
    await tarea.save();

    // Enviar alerta por correo si se tiene email
    if (emailFinal) {
      try {
        await enviarAlertaTareaLocal(tarea, 'NUEVA_TAREA');
        console.log('✅ Alerta de nueva tarea enviada a:', emailFinal);
      } catch (emailError) {
        console.error('⚠️ Error enviando alerta por correo:', emailError);
        // No fallar la creación de la tarea por error de email
      }
    } else {
      console.log('⚠️ No se envió alerta: no hay email disponible para el usuario');
    }

    res.status(201).json({
      success: true,
      data: tarea,
      mensaje: 'Tarea creada exitosamente'
    });
  } catch (error) {
    console.error('❌ Error creando tarea:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error interno del servidor',
      error: error.message
    });
  }
};

// Editar tarea
export const editarTarea = async (req, res) => {
  try {
    const { id } = req.params;
    const { texto, fecha, prioridad, emailResponsable } = req.body;
    
    // Obtener el email del usuario desde la base de datos si no se proporciona
    let emailFinal = emailResponsable;
    if (!emailFinal) {
      try {
        const tareaExistente = await Tarea.findById(id);
        if (tareaExistente && tareaExistente.login) {
          const usuario = await SecurUser.findOne({ login: tareaExistente.login });
          if (usuario && usuario.email) {
            emailFinal = usuario.email;
            console.log(`📧 Email obtenido automáticamente para edición de ${tareaExistente.login}: ${emailFinal}`);
          } else {
            // Si no se encuentra en SecurUser, usar un email por defecto
            emailFinal = 'danalyst@proserpuertos.com.co';
            console.log(`⚠️ Usuario ${tareaExistente.login} no encontrado en SecurUser para edición, usando email por defecto: ${emailFinal}`);
          }
        }
      } catch (error) {
        console.error('❌ Error obteniendo email del usuario para edición:', error);
        // En caso de error, usar email por defecto
        emailFinal = 'danalyst@proserpuertos.com.co';
        console.log(`⚠️ Error obteniendo email para edición, usando email por defecto: ${emailFinal}`);
      }
    }
    
    const tarea = await Tarea.findByIdAndUpdate(
      id, 
      { 
        texto, 
        fecha: fecha ? new Date(fecha) : undefined, 
        prioridad,
        emailResponsable: emailFinal
      }, 
      { new: true }
    );
    
    if (!tarea) {
      return res.status(404).json({ 
        success: false,
        mensaje: 'Tarea no encontrada' 
      });
    }

    // Enviar alerta por correo si se tiene email
    if (emailFinal) {
      try {
        await enviarAlertaTareaLocal(tarea, 'TAREA_ACTUALIZADA');
        console.log('✅ Alerta de tarea actualizada enviada a:', emailFinal);
      } catch (emailError) {
        console.error('⚠️ Error enviando alerta por correo:', emailError);
      }
    } else {
      console.log('⚠️ No se envió alerta de actualización: no hay email disponible');
    }

    res.json({
      success: true,
      data: tarea,
      mensaje: 'Tarea actualizada exitosamente'
    });
  } catch (error) {
    console.error('❌ Error editando tarea:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error interno del servidor',
      error: error.message
    });
  }
};

// Marcar cumplida/no cumplida
export const marcarCumplida = async (req, res) => {
  try {
    const { id } = req.params;
    const tarea = await Tarea.findById(id);
    
    if (!tarea) {
      return res.status(404).json({ 
        success: false,
        mensaje: 'Tarea no encontrada' 
      });
    }

    const estadoAnterior = tarea.cumplida;
    tarea.cumplida = !tarea.cumplida;
    tarea.fechaCumplimiento = tarea.cumplida ? new Date() : null;
    await tarea.save();

    // Enviar alerta por correo si se proporciona email
    if (tarea.emailResponsable) {
      try {
        const tipoAlerta = tarea.cumplida ? 'TAREA_COMPLETADA' : 'TAREA_REABIERTA';
        await enviarAlertaTareaLocal(tarea, tipoAlerta);
        console.log(`✅ Alerta de ${tipoAlerta} enviada por correo`);
      } catch (emailError) {
        console.error('⚠️ Error enviando alerta por correo:', emailError);
      }
    }

    res.json({
      success: true,
      data: tarea,
      mensaje: tarea.cumplida ? 'Tarea marcada como cumplida' : 'Tarea marcada como pendiente'
    });
  } catch (error) {
    console.error('❌ Error marcando tarea:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error interno del servidor',
      error: error.message
    });
  }
};

// Eliminar tarea
export const eliminarTarea = async (req, res) => {
  try {
    const { id } = req.params;
    const tarea = await Tarea.findByIdAndDelete(id);
    
    if (!tarea) {
      return res.status(404).json({ 
        success: false,
        mensaje: 'Tarea no encontrada' 
      });
    }

    // Enviar alerta por correo si se proporciona email
    if (tarea.emailResponsable) {
      try {
        await enviarAlertaTareaLocal(tarea, 'TAREA_ELIMINADA');
        console.log('✅ Alerta de tarea eliminada enviada por correo');
      } catch (emailError) {
        console.error('⚠️ Error enviando alerta por correo:', emailError);
      }
    }

    res.json({
      success: true,
      mensaje: 'Tarea eliminada exitosamente'
    });
  } catch (error) {
    console.error('❌ Error eliminando tarea:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error interno del servidor',
      error: error.message
    });
  }
};

// Obtener tareas por prioridad
export const getTareasPorPrioridad = async (req, res) => {
  try {
    const { prioridad } = req.params;
    const { login } = req.query;
    
    if (!prioridad || !['ALTA', 'MEDIA', 'BAJA'].includes(prioridad)) {
      return res.status(400).json({
        success: false,
        mensaje: 'Prioridad debe ser ALTA, MEDIA o BAJA'
      });
    }

    const filtro = { prioridad };
    if (login) filtro.login = login;

    const tareas = await Tarea.find(filtro).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: tareas,
      total: tareas.length
    });
  } catch (error) {
    console.error('❌ Error obteniendo tareas por prioridad:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error interno del servidor',
      error: error.message
    });
  }
};

// Obtener resumen de tareas
export const getResumenTareas = async (req, res) => {
  try {
    const { login } = req.query;
    
    const filtro = login ? { login } : {};
    
    const totalTareas = await Tarea.countDocuments(filtro);
    const tareasCumplidas = await Tarea.countDocuments({ ...filtro, cumplida: true });
    const tareasPendientes = totalTareas - tareasCumplidas;
    
    const tareasPorPrioridad = await Tarea.aggregate([
      { $match: filtro },
      { $group: { _id: '$prioridad', count: { $sum: 1 } } }
    ]);

    const resumen = {
      total: totalTareas,
      cumplidas: tareasCumplidas,
      pendientes: tareasPendientes,
      porcentajeCumplimiento: totalTareas > 0 ? Math.round((tareasCumplidas / totalTareas) * 100) : 0,
      porPrioridad: tareasPorPrioridad.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {})
    };

    res.json({
      success: true,
      data: resumen
    });
  } catch (error) {
    console.error('❌ Error obteniendo resumen de tareas:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error interno del servidor',
      error: error.message
    });
  }
};

// Función auxiliar para enviar alertas por correo
const enviarAlertaTareaLocal = async (tarea, tipoAlerta) => {
  try {
    const datosEmail = {
      numeroCaso: `TAREA-${tarea._id}`,
      nombreResponsable: tarea.login,
      emailResponsable: tarea.emailResponsable,
      aseguradora: 'Sistema de Tareas',
      asegurado: 'Usuario',
      fechaAsignacion: tarea.createdAt.toLocaleDateString(),
      quienAsigna: 'Sistema de Tareas',
      emailQuienAsigna: 'sistema@proserpuertos.com.co',
      observaciones: `Tarea: ${tarea.texto}`,
      tarea: {
        id: tarea._id,
        texto: tarea.texto,
        fecha: tarea.fecha,
        prioridad: tarea.prioridad,
        cumplida: tarea.cumplida,
        fechaCumplimiento: tarea.fechaCumplimiento,
        tipoAlerta
      }
    };

    await enviarAlertaTarea(datosEmail);
  } catch (error) {
    console.error('❌ Error enviando alerta de tarea:', error);
    throw error;
  }
};
