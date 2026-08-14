export const ROLES_VALIDOS = [
  'admin',
  'soporte',
  'usuario',
  'visualizador',
  'puertos',
  'contractor_zurich',
  'contractor_alfa',
  'contractor_sura',
];

const ETIQUETA_CONTRACTOR = 'Zurich, Alfa y Sura';

/** Texto que se agrega al nombre entre paréntesis al asignar el rol. */
export const SUFIJO_NOMBRE_POR_ROL = {
  contractor_zurich: ETIQUETA_CONTRACTOR,
  contractor_alfa: ETIQUETA_CONTRACTOR,
  contractor_sura: ETIQUETA_CONTRACTOR,
};

const SUFIJOS_LEGACY = ['Contractor Zurich', 'Zurich', 'Alfa', 'Sura'];

const APIS_CONTRACTOR = ['/api/zurich', '/api/seguros-alfa', '/api/sura'];
const MENSAJE_CONTRACTOR = 'Su rol solo permite trabajar los módulos Zurich, Alfa y Sura.';

export const CONTRATISTAS_MODULO = {
  contractor_zurich: { apis: APIS_CONTRACTOR, mensaje: MENSAJE_CONTRACTOR },
  contractor_alfa: { apis: APIS_CONTRACTOR, mensaje: MENSAJE_CONTRACTOR },
  contractor_sura: { apis: APIS_CONTRACTOR, mensaje: MENSAJE_CONTRACTOR },
};

export function normalizarRol(rol) {
  return String(rol || '').trim().toLowerCase();
}

export function esRolValido(rol) {
  return ROLES_VALIDOS.includes(normalizarRol(rol));
}

export function esRolContractor(rol) {
  return Boolean(CONTRATISTAS_MODULO[normalizarRol(rol)]);
}

function escapeRegExp(valor) {
  return String(valor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function quitarSufijosRolDelNombre(nombre) {
  let n = String(nombre || '').trim();
  const etiquetas = [...new Set([...Object.values(SUFIJO_NOMBRE_POR_ROL), ...SUFIJOS_LEGACY])];
  // Más largos primero para no dejar residuos tipo ", Alfa y Sura".
  etiquetas.sort((a, b) => b.length - a.length);
  for (const etiqueta of etiquetas) {
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
