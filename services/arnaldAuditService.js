import ArnaldAuditLog from '../models/ArnaldAuditLog.js';

const ACCIONES_VALIDAS = new Set([
  'LOGIN',
  'LOGOUT',
  'NAVIGATE',
  'CREATE',
  'UPDATE',
  'DELETE',
  'VIEW',
  'DRAFT_SAVE',
  'DRAFT_RESTORE',
  'DRAFT_DISCARD',
  'OTHER',
]);

export function extraerIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || '';
}

export function usuarioDesdeReq(req, extra = {}) {
  const u = req.usuario || req.user || {};
  return {
    usuarioId: extra.usuarioId || u.id || u._id || null,
    login: extra.login || u.login || '',
    nombre: extra.nombre || u.name || u.nombre || '',
    rol: extra.rol || u.role || u.rol || '',
  };
}

export function moduloDesdeRuta(ruta = '') {
  const path = String(ruta || '');
  const pares = [
    ['/api/seguros-alfa', 'alfa'],
    ['/api/sura', 'sura'],
    ['/api/zurich-listado', 'zurich'],
    ['/api/zurich', 'zurich'],
    ['/api/bbva-cat-listado', 'bbva-cat'],
    ['/api/bbva-cat', 'bbva-cat'],
    ['/api/allias-listado', 'allias'],
    ['/api/allias', 'allias'],
    ['/api/previsora-listado', 'previsora'],
    ['/api/previsora', 'previsora'],
    ['/api/equidad-fdm', 'equidad-fdm'],
    ['/api/siniestros-express', 'express'],
    ['/api/express-catalogos', 'express'],
    ['/api/complex-subtareas', 'complex'],
    ['/api/complex', 'complex'],
    ['/api/casos', 'complex'],
    ['/api/puertos', 'puertos'],
    ['/api/propiedades', 'propiedades'],
    ['/api/inspeccion-propiedades', 'propiedades'],
    ['/api/riesgos', 'riesgos'],
    ['/api/historial-formularios', 'historial'],
    ['/api/matrices-riesgo', 'matriz'],
    ['/api/sg-sst', 'sg-sst'],
    ['/api/secur-auth', 'auth'],
    ['/api/documentos', 'documentos'],
    ['/api/arnald-drafts', 'borradores'],
    ['/api/arnald-logs', 'auditoria'],
  ];
  const hit = pares.find(([prefijo]) => path.startsWith(prefijo));
  return hit ? hit[1] : 'plataforma';
}

export function accionDesdeMetodo(method = '') {
  switch (String(method || '').toUpperCase()) {
    case 'POST':
      return 'CREATE';
    case 'PUT':
    case 'PATCH':
      return 'UPDATE';
    case 'DELETE':
      return 'DELETE';
    case 'GET':
      return 'VIEW';
    default:
      return 'OTHER';
  }
}

export async function registrarEventoAuditoria(entrada = {}) {
  try {
    const accion = ACCIONES_VALIDAS.has(entrada.accion) ? entrada.accion : 'OTHER';
    await ArnaldAuditLog.create({
      occurredAt: entrada.occurredAt || new Date(),
      usuarioId: entrada.usuarioId ? String(entrada.usuarioId) : null,
      login: entrada.login || '',
      nombre: entrada.nombre || '',
      rol: entrada.rol || '',
      accion,
      modulo: entrada.modulo || 'plataforma',
      recursoTipo: entrada.recursoTipo || '',
      recursoId: entrada.recursoId ? String(entrada.recursoId) : '',
      metodo: entrada.metodo || '',
      ruta: String(entrada.ruta || '').slice(0, 500),
      statusCode: entrada.statusCode ?? null,
      resumen: String(entrada.resumen || '').slice(0, 500),
      meta: entrada.meta && typeof entrada.meta === 'object' ? entrada.meta : {},
      ip: entrada.ip || '',
      userAgent: String(entrada.userAgent || '').slice(0, 400),
    });
  } catch (error) {
    console.error('⚠️ No se pudo registrar auditoría Arnald:', error.message);
  }
}

export function registrarLoginAuditoria(req, usuario = {}) {
  return registrarEventoAuditoria({
    ...usuarioDesdeReq(req, {
      usuarioId: usuario._id || usuario.id,
      login: usuario.login,
      nombre: usuario.name || usuario.nombre,
      rol: usuario.role || usuario.rol,
    }),
    accion: 'LOGIN',
    modulo: 'auth',
    metodo: 'POST',
    ruta: req.originalUrl || req.url,
    statusCode: 200,
    resumen: `Inicio de sesión: ${usuario.login || usuario.name || ''}`.trim(),
    ip: extraerIp(req),
    userAgent: req.headers?.['user-agent'] || '',
  });
}

export function registrarLogoutAuditoria(req, usuario = {}) {
  return registrarEventoAuditoria({
    ...usuarioDesdeReq(req, {
      usuarioId: usuario.id || usuario._id,
      login: usuario.login,
      nombre: usuario.name || usuario.nombre,
      rol: usuario.role || usuario.rol,
    }),
    accion: 'LOGOUT',
    modulo: 'auth',
    metodo: 'POST',
    ruta: req.originalUrl || req.url,
    statusCode: 200,
    resumen: `Cierre de sesión: ${usuario.login || ''}`.trim(),
    ip: extraerIp(req),
    userAgent: req.headers?.['user-agent'] || '',
  });
}
