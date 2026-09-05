import ArnaldAuditLog from '../models/ArnaldAuditLog.js';
import {
  extraerIp,
  moduloDesdeRuta,
  registrarEventoAuditoria,
  usuarioDesdeReq,
} from '../services/arnaldAuditService.js';

function esAdminOSoporte(req) {
  const role = String(req.usuario?.role || req.user?.role || '').toLowerCase();
  return role === 'admin' || role === 'soporte' || role === 'administrador';
}

export async function listarLogsArnald(req, res) {
  try {
    if (!esAdminOSoporte(req)) {
      return res.status(403).json({ message: req.t?.('noPermissions') || 'Sin permisos' });
    }

    const {
      login,
      accion,
      modulo,
      desde,
      hasta,
      q,
      page = 1,
      limit = 50,
    } = req.query;

    const filtro = {};
    if (login) filtro.login = new RegExp(`^${String(login).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if (accion) filtro.accion = String(accion).toUpperCase();
    if (modulo) filtro.modulo = String(modulo);
    if (desde || hasta) {
      filtro.occurredAt = {};
      if (desde) filtro.occurredAt.$gte = new Date(desde);
      if (hasta) filtro.occurredAt.$lte = new Date(hasta);
    }
    if (q) {
      const texto = String(q).trim();
      filtro.$or = [
        { login: { $regex: texto, $options: 'i' } },
        { nombre: { $regex: texto, $options: 'i' } },
        { ruta: { $regex: texto, $options: 'i' } },
        { resumen: { $regex: texto, $options: 'i' } },
        { recursoId: { $regex: texto, $options: 'i' } },
      ];
    }

    const pagina = Math.max(Number(page) || 1, 1);
    const tam = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const skip = (pagina - 1) * tam;

    const [items, total] = await Promise.all([
      ArnaldAuditLog.find(filtro).sort({ occurredAt: -1 }).skip(skip).limit(tam).lean(),
      ArnaldAuditLog.countDocuments(filtro),
    ]);

    res.json({
      items,
      total,
      page: pagina,
      limit: tam,
      pages: Math.ceil(total / tam) || 1,
    });
  } catch (error) {
    console.error('❌ Error listando logs Arnald:', error);
    res.status(500).json({ message: req.t?.('serverError') || 'Error del servidor' });
  }
}

export async function registrarEventoCliente(req, res) {
  try {
    const usuario = usuarioDesdeReq(req, {
      nombre: req.body?.nombre || '',
    });
    if (!usuario.usuarioId && !usuario.login) {
      // Telemetría: no autenticado → 204 (evita ruido 401/403 en consola del cliente)
      return res.status(204).end();
    }

    const accion = String(req.body?.accion || 'NAVIGATE').toUpperCase();
    const ruta = String(req.body?.ruta || req.body?.path || '').slice(0, 500);
    await registrarEventoAuditoria({
      ...usuario,
      accion: ['NAVIGATE', 'DRAFT_RESTORE', 'DRAFT_DISCARD', 'VIEW'].includes(accion)
        ? accion
        : 'NAVIGATE',
      modulo: req.body?.modulo || moduloDesdeRuta(ruta) || 'plataforma',
      recursoId: req.body?.recursoId || '',
      metodo: 'POST',
      ruta,
      statusCode: 200,
      resumen: req.body?.resumen || ruta,
      meta: {
        titulo: req.body?.titulo || '',
      },
      ip: extraerIp(req),
      userAgent: req.headers?.['user-agent'] || '',
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Error registrando evento de cliente:', error);
    res.status(500).json({ message: req.t?.('serverError') || 'Error del servidor' });
  }
}
