/**
 * Solo este login puede pulsar Actualizar / execute de Control y Seguimiento Alfa.
 */
export const LOGIN_ALFA_EXCEL_ACTUALIZAR = '1065012991';

export function esUsuarioAlfaExcelActualizar(user = {}) {
  const login = String(user.login || '').trim();
  const cedula = String(user.cedula || '').trim();
  return login === LOGIN_ALFA_EXCEL_ACTUALIZAR || cedula === LOGIN_ALFA_EXCEL_ACTUALIZAR;
}

export function verificarLoginAlfaExcelActualizar(req, res, next) {
  const u = req.usuario || req.user || {};
  if (esUsuarioAlfaExcelActualizar(u)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    error: 'Solo el usuario autorizado puede aplicar actualizaciones de Control y Seguimiento',
    code: 'ALFA_EXCEL_ACTUALIZAR_FORBIDDEN',
  });
}
