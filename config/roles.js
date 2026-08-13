export const ROLES_VALIDOS = [
  'admin',
  'soporte',
  'usuario',
  'visualizador',
  'puertos',
  'contractor_zurich',
];

/** Texto que se agrega al nombre entre paréntesis al asignar el rol. */
export const SUFIJO_NOMBRE_POR_ROL = {
  contractor_zurich: 'Contractor Zurich',
};

export function normalizarRol(rol) {
  return String(rol || '').trim().toLowerCase();
}

export function esRolValido(rol) {
  return ROLES_VALIDOS.includes(normalizarRol(rol));
}

function escapeRegExp(valor) {
  return String(valor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function quitarSufijosRolDelNombre(nombre) {
  let n = String(nombre || '').trim();
  for (const etiqueta of Object.values(SUFIJO_NOMBRE_POR_ROL)) {
    n = n.replace(new RegExp(`\\s*\\(${escapeRegExp(etiqueta)}\\)\\s*$`, 'i'), '').trim();
  }
  return n;
}

export function aplicarSufijoNombrePorRol(nombre, rol) {
  const base = quitarSufijosRolDelNombre(nombre);
  const etiqueta = SUFIJO_NOMBRE_POR_ROL[normalizarRol(rol)];
  if (!etiqueta || !base) return base;
  return `${base} (${etiqueta})`;
}
