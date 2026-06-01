import SesionUsuario from '../models/SesionUsuario.js';

/**
 * Middleware para actualizar la última actividad de la sesión del usuario
 * Se ejecuta en cada petición autenticada para mantener la sesión activa
 */
export async function actualizarActividadSesion(req, res, next) {
  try {
    // Solo actualizar si hay un usuario autenticado
    if (req.usuario && req.usuario.id) {
      // Actualizar última actividad de la sesión activa más reciente
      await SesionUsuario.updateOne(
        {
          usuarioId: req.usuario.id,
          activa: true
        },
        {
          $set: {
            updatedAt: new Date()
          }
        },
        {
          sort: { inicioSesion: -1 }
        }
      );
    }
  } catch (error) {
    // No bloquear la petición si falla la actualización
    console.log('⚠️ Error actualizando actividad de sesión:', error.message);
  }
  
  next();
}

