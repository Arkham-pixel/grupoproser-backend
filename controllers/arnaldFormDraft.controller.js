import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/secrets.js';
import {
  eliminarBorrador,
  listarBorradoresDeUsuario,
  listarTodosLosBorradores,
  obtenerBorrador,
  upsertBorrador,
} from '../services/arnaldFormDraftService.js';
import { usuarioDesdeReq } from '../services/arnaldAuditService.js';

function esAdminOSoporte(req) {
  const role = String(req.usuario?.role || req.user?.role || '').toLowerCase();
  return role === 'admin' || role === 'soporte' || role === 'administrador';
}

function usuarioIdReq(req) {
  const u = usuarioDesdeReq(req);
  return u.usuarioId ? String(u.usuarioId) : null;
}

export async function guardarBorrador(req, res) {
  try {
    const usuario = usuarioDesdeReq(req, { nombre: req.body?.nombre || '' });
    if (!usuario.usuarioId) {
      return res.status(401).json({ message: req.t?.('tokenNotProvided') || 'No autenticado' });
    }
    const formKey = String(req.body?.formKey || '').trim();
    if (!formKey) {
      return res.status(400).json({ message: 'formKey es obligatorio' });
    }
    const doc = await upsertBorrador({
      usuarioId: usuario.usuarioId,
      login: usuario.login,
      nombre: usuario.nombre || req.body?.nombre || '',
      formKey,
      modulo: req.body?.modulo || 'plataforma',
      recursoId: req.body?.recursoId || '',
      titulo: req.body?.titulo || '',
      payload: req.body?.payload || {},
    });
    res.json({
      ok: true,
      formKey: doc.formKey,
      savedAt: doc.savedAt,
      expiresAt: doc.expiresAt,
    });
  } catch (error) {
    console.error('❌ Error guardando borrador Arnald:', error);
    res.status(500).json({ message: req.t?.('serverError') || 'Error del servidor' });
  }
}

export async function obtenerMiBorrador(req, res) {
  try {
    const usuarioId = usuarioIdReq(req);
    if (!usuarioId) {
      return res.status(401).json({ message: req.t?.('tokenNotProvided') || 'No autenticado' });
    }
    const formKey = String(req.query.formKey || '').trim();
    if (!formKey) {
      return res.status(400).json({ message: 'formKey es obligatorio' });
    }
    const doc = await obtenerBorrador(usuarioId, formKey);
    res.json({ draft: doc || null });
  } catch (error) {
    console.error('❌ Error obteniendo borrador Arnald:', error);
    res.status(500).json({ message: req.t?.('serverError') || 'Error del servidor' });
  }
}

export async function listarMisBorradores(req, res) {
  try {
    const usuarioId = usuarioIdReq(req);
    if (!usuarioId) {
      return res.status(401).json({ message: req.t?.('tokenNotProvided') || 'No autenticado' });
    }
    const items = await listarBorradoresDeUsuario(usuarioId);
    res.json({ items });
  } catch (error) {
    console.error('❌ Error listando borradores Arnald:', error);
    res.status(500).json({ message: req.t?.('serverError') || 'Error del servidor' });
  }
}

export async function listarBorradoresAdmin(req, res) {
  try {
    if (!esAdminOSoporte(req)) {
      return res.status(403).json({ message: req.t?.('noPermissions') || 'Sin permisos' });
    }
    const items = await listarTodosLosBorradores({
      login: req.query.login,
      modulo: req.query.modulo,
      limit: req.query.limit,
    });
    res.json({ items });
  } catch (error) {
    console.error('❌ Error listando borradores admin:', error);
    res.status(500).json({ message: req.t?.('serverError') || 'Error del servidor' });
  }
}

export async function borrarMiBorrador(req, res) {
  try {
    const usuarioId = usuarioIdReq(req);
    if (!usuarioId) {
      return res.status(401).json({ message: req.t?.('tokenNotProvided') || 'No autenticado' });
    }
    const formKey = String(req.query.formKey || req.body?.formKey || '').trim();
    if (!formKey) {
      return res.status(400).json({ message: 'formKey es obligatorio' });
    }
    await eliminarBorrador(usuarioId, formKey);
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Error eliminando borrador Arnald:', error);
    res.status(500).json({ message: req.t?.('serverError') || 'Error del servidor' });
  }
}

export async function guardarBorradorBeacon(req, res) {
  try {
    const token =
      req.headers.authorization?.split(' ')[1] ||
      req.body?.token ||
      req.query?.token;
    if (!token) {
      return res.status(200).json({ ok: false });
    }
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      decoded = jwt.decode(token);
    }
    if (!decoded?.id) {
      return res.status(200).json({ ok: false });
    }

    const formKey = String(req.body?.formKey || '').trim();
    if (!formKey) {
      return res.status(200).json({ ok: false });
    }

    await upsertBorrador({
      usuarioId: decoded.id,
      login: decoded.login || req.body?.login || '',
      nombre: req.body?.nombre || '',
      formKey,
      modulo: req.body?.modulo || 'plataforma',
      recursoId: req.body?.recursoId || '',
      titulo: req.body?.titulo || '',
      payload: req.body?.payload || {},
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('⚠️ Beacon de borrador Arnald:', error.message);
    res.status(200).json({ ok: false });
  }
}
