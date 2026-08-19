export const ROLES_VALIDOS = [
  'admin',
  'soporte',
  'usuario',
  'visualizador',
  'puertos',
  'ajustador_lider',
  'ajustador',
  'inspector',
  'contractor_zurich',
  'contractor_alfa',
  'contractor_sura',
  'contractor_solo_zurich',
];

/** Contratista con acceso únicamente al módulo Zurich. */
export const ROL_SOLO_ZURICH = 'contractor_solo_zurich';

const ETIQUETA_TRES = 'Zurich, Alfa y Sura';
const ETIQUETA_SOLO_ZURICH = 'Zurich';

/** Texto que se agrega al nombre entre paréntesis al asignar el rol. */
export const SUFIJO_NOMBRE_POR_ROL = {
  contractor_zurich: ETIQUETA_TRES,
  contractor_alfa: ETIQUETA_TRES,
  contractor_sura: ETIQUETA_TRES,
  contractor_solo_zurich: ETIQUETA_SOLO_ZURICH,
};

const SUFIJOS_LEGACY = ['Contractor Zurich', 'Zurich', 'Alfa', 'Sura'];

const APIS_TRES = ['/api/zurich', '/api/zurich-listado', '/api/seguros-alfa', '/api/sura'];
const APIS_SOLO_ZURICH = ['/api/zurich'];

export const CONTRATISTAS_MODULO = {
  contractor_zurich: {
    apis: APIS_TRES,
    mensaje: 'Su rol solo permite trabajar los módulos Zurich, Alfa y Sura.',
  },
  contractor_alfa: {
    apis: APIS_TRES,
    mensaje: 'Su rol solo permite trabajar los módulos Zurich, Alfa y Sura.',
  },
  contractor_sura: {
    apis: APIS_TRES,
    mensaje: 'Su rol solo permite trabajar los módulos Zurich, Alfa y Sura.',
  },
  contractor_solo_zurich: {
    apis: APIS_SOLO_ZURICH,
    mensaje: 'Su rol Zurich solo permite trabajar el módulo Zurich.',
  },
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
