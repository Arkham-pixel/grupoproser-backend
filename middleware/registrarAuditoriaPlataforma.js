import {
  accionDesdeMetodo,
  extraerIp,
  moduloDesdeRuta,
  registrarEventoAuditoria,
  usuarioDesdeReq,
} from '../services/arnaldAuditService.js';

const RUTAS_OMITIR = [
  '/api/health',
  '/api/arnald-logs',
  '/api/arnald-drafts',
  '/api/secur-auth/verificar-sesion',
  '/api/secur-auth/refresh-token',
  '/api/storage/file',
];

const METODOS_MUTACION = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function debeOmitir(req) {
  const ruta = `${req.originalUrl || req.url || ''}`.split('?')[0];
  if (RUTAS_OMITIR.some((prefijo) => ruta.startsWith(prefijo))) return true;
  if (ruta.startsWith('/api/secur-auth/login')) return true;
  if (ruta.startsWith('/api/secur-auth/logout')) return true;
  if (!METODOS_MUTACION.has(String(req.method || '').toUpperCase())) return true;
  return false;
}

function extraerRecursoId(req) {
  const params = req.params || {};
  return params.id || params.casoId || params.formKey || '';
}

export function registrarAuditoriaPlataforma(req, res, next) {
  if (debeOmitir(req)) {
    next();
    return;
  }

  res.on('finish', () => {
    const usuario = usuarioDesdeReq(req);
    if (!usuario.usuarioId && !usuario.login) return;
    if (res.statusCode >= 500) return;

    const ruta = `${req.originalUrl || req.url || ''}`.split('?')[0];
    const metodo = String(req.method || '').toUpperCase();
    registrarEventoAuditoria({
      ...usuario,
      accion: accionDesdeMetodo(metodo),
      modulo: moduloDesdeRuta(ruta),
      recursoId: extraerRecursoId(req),
      metodo,
      ruta,
      statusCode: res.statusCode,
      resumen: `${metodo} ${ruta} → ${res.statusCode}`,
      ip: extraerIp(req),
      userAgent: req.headers?.['user-agent'] || '',
    });
  });

  next();
}
