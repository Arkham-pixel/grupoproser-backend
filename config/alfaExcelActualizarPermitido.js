/**
 * Logins que pueden:
 * - Actualizar / execute de Control y Seguimiento Alfa (botones SharePoint ↔ Excel)
 * - Pulsar «Subir» / «No subir» documentos del archivero a SharePoint
 */
export const LOGINS_ALFA_EXCEL_ACTUALIZAR = Object.freeze([
  '1065012991', // TI
  '1003717060', // DANIELA NEGRETE
]);

/** @deprecated usar LOGINS_ALFA_EXCEL_ACTUALIZAR */
export const LOGIN_ALFA_EXCEL_ACTUALIZAR = LOGINS_ALFA_EXCEL_ACTUALIZAR[0];

function idsUsuario(user = {}) {
  return [user.login, user.cedula]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

export function esUsuarioAlfaExcelActualizar(user = {}) {
  const ids = idsUsuario(user);
  if (!ids.length) return false;
  return ids.some((id) => LOGINS_ALFA_EXCEL_ACTUALIZAR.includes(id));
}

/** Alias: mismo usuario autorizado para encolar sync SharePoint del archivero. */
export function esUsuarioAlfaSharePointSubir(user = {}) {
  return esUsuarioAlfaExcelActualizar(user);
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
