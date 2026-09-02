import {
  listarNotificacionesDeUsuario,
  marcarNotificacionLeida,
  marcarTodasLeidas,
} from '../services/notificacionesOperativasService.js';

function identidadDesdeReq(req) {
  const user = req.user || req.usuario || {};
  return {
    userId: user.id || user._id || null,
    login: user.login || null,
  };
}

export async function getMisNotificacionesOperativas(req, res) {
  try {
    const { userId, login } = identidadDesdeReq(req);
    if (!userId && !login) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }
    const limit = req.query.limit;
    const data = await listarNotificacionesDeUsuario({ userId, login, limit });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error('❌ getMisNotificacionesOperativas:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener notificaciones',
      detalle: error.message,
    });
  }
}

export async function patchLeerNotificacionOperativa(req, res) {
  try {
    const { userId, login } = identidadDesdeReq(req);
    if (!userId && !login) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }
    const doc = await marcarNotificacionLeida({
      id: req.params.id,
      userId,
      login,
    });
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Notificación no encontrada' });
    }
    return res.json({ success: true, data: doc });
  } catch (error) {
    console.error('❌ patchLeerNotificacionOperativa:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al marcar la notificación',
      detalle: error.message,
    });
  }
}

export async function postLeerTodasNotificacionesOperativas(req, res) {
  try {
    const { userId, login } = identidadDesdeReq(req);
    if (!userId && !login) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }
    const data = await marcarTodasLeidas({ userId, login });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error('❌ postLeerTodasNotificacionesOperativas:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al marcar las notificaciones',
      detalle: error.message,
    });
  }
}
