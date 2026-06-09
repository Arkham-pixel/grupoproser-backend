/** Debe coincidir con frontend/src/config/expressCatalogosPermitidos.js */

export const LOGIN_CATALOGOS_EXPRESS_EXTRA = [
  '1048210029', // Alexander Escalante
  '1007183772', // Maria Garcias
  '1044800214', // Gabriel Moreno
];

export const EMAILS_CATALOGOS_EXPRESS_EXTRA = ['aescalante@proserpuertos.com.co'];

export function rolPuedeCatalogosExpress(rol) {
  const r = String(rol || '')
    .trim()
    .toLowerCase();
  return r === 'admin' || r === 'administrador' || r === 'soporte';
}

export function usuarioAutorizadoCatalogosExpress(usuario = {}) {
  const { cedula, login, email, rol } = usuario;
  if (rolPuedeCatalogosExpress(rol)) return true;

  const c = String(cedula || '').trim();
  const l = String(login || '').trim();
  const e = String(email || '')
    .trim()
    .toLowerCase();

  if (LOGIN_CATALOGOS_EXPRESS_EXTRA.includes(c) || LOGIN_CATALOGOS_EXPRESS_EXTRA.includes(l)) {
    return true;
  }
  return EMAILS_CATALOGOS_EXPRESS_EXTRA.includes(e);
}
