import ArnaldFormDraft from '../models/ArnaldFormDraft.js';

const RETENCION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_STRING = 40_000;
const CAMPOS_EXCLUIDOS = new Set([
  'historialDocs',
  'password',
  'pswd',
  'token',
  'tempToken',
]);

export function sanitizarPayloadBorrador(valor, profundidad = 0) {
  if (valor == null) return valor;
  if (profundidad > 8) return undefined;
  if (typeof valor === 'string') {
    if (valor.startsWith('data:')) return '[archivo-omitido]';
    if (valor.length > MAX_STRING) return `${valor.slice(0, 200)}…`;
    return valor;
  }
  if (typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) {
    return valor
      .slice(0, 200)
      .map((item) => sanitizarPayloadBorrador(item, profundidad + 1));
  }
  const limpio = {};
  for (const [clave, item] of Object.entries(valor)) {
    if (CAMPOS_EXCLUIDOS.has(clave)) continue;
    const sanitizado = sanitizarPayloadBorrador(item, profundidad + 1);
    if (sanitizado !== undefined) limpio[clave] = sanitizado;
  }
  return limpio;
}

export function fechaExpiracionBorrador(desde = new Date()) {
  return new Date(desde.getTime() + RETENCION_MS);
}

export async function upsertBorrador({
  usuarioId,
  login,
  nombre,
  formKey,
  modulo,
  recursoId,
  titulo,
  payload,
}) {
  if (!usuarioId || !formKey) return null;
  const now = new Date();
  return ArnaldFormDraft.findOneAndUpdate(
    { usuarioId: String(usuarioId), formKey: String(formKey) },
    {
      $set: {
        login: login || '',
        nombre: nombre || '',
        modulo: modulo || 'plataforma',
        recursoId: recursoId ? String(recursoId) : '',
        titulo: titulo || '',
        payload: sanitizarPayloadBorrador(payload) || {},
        savedAt: now,
        expiresAt: fechaExpiracionBorrador(now),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function obtenerBorrador(usuarioId, formKey) {
  if (!usuarioId || !formKey) return null;
  return ArnaldFormDraft.findOne({
    usuarioId: String(usuarioId),
    formKey: String(formKey),
  }).lean();
}

export async function listarBorradoresDeUsuario(usuarioId) {
  if (!usuarioId) return [];
  return ArnaldFormDraft.find({ usuarioId: String(usuarioId) })
    .sort({ savedAt: -1 })
    .select('-payload')
    .lean();
}

export async function listarTodosLosBorradores({ login, modulo, limit = 100 } = {}) {
  const filtro = {};
  if (login) filtro.login = new RegExp(`^${String(login).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  if (modulo) filtro.modulo = modulo;
  return ArnaldFormDraft.find(filtro)
    .sort({ savedAt: -1 })
    .limit(Math.min(Number(limit) || 100, 300))
    .select('-payload')
    .lean();
}

export async function eliminarBorrador(usuarioId, formKey) {
  if (!usuarioId || !formKey) return { deletedCount: 0 };
  return ArnaldFormDraft.deleteOne({
    usuarioId: String(usuarioId),
    formKey: String(formKey),
  });
}
