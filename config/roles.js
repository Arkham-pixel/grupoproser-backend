export const ROLES_VALIDOS = ['admin', 'soporte', 'usuario', 'visualizador', 'puertos'];

export function normalizarRol(rol) {
  return String(rol || '').trim().toLowerCase();
}

export function esRolValido(rol) {
  return ROLES_VALIDOS.includes(normalizarRol(rol));
}
