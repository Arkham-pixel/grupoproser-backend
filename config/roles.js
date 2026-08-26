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
  'contractor_solo_bbva',
  'contractor_solo_equidad',
  'contractor_solo_previsora',
  'contractor_catastroficos',
];

/** Contratista con acceso únicamente al módulo Zurich. */
export const ROL_SOLO_ZURICH = 'contractor_solo_zurich';

/** Contratista con acceso únicamente al módulo BBVA CAT. */
export const ROL_SOLO_BBVA = 'contractor_solo_bbva';

/** Contratista solo bandeja Equidad FDM (reporte, sin crear/liquidar). */
export const ROL_SOLO_EQUIDAD = 'contractor_solo_equidad';

/** Contratista solo módulo Previsora (Home + Previsora). */
export const ROL_SOLO_PREVISORA = 'contractor_solo_previsora';

/** Contratista con todos los módulos catastróficos. */
export const ROL_CATASTROFICOS = 'contractor_catastroficos';

const ETIQUETA_TRES = 'Zurich, Alfa, Sura y BBVA';
const ETIQUETA_SOLO_ZURICH = 'Zurich';
const ETIQUETA_SOLO_BBVA = 'BBVA';
const ETIQUETA_SOLO_EQUIDAD = 'Equidad FDM';
const ETIQUETA_SOLO_PREVISORA = 'Previsora';
const ETIQUETA_CATASTROFICOS = 'Catastróficos';

/** Texto que se agrega al nombre entre paréntesis al asignar el rol. */
export const SUFIJO_NOMBRE_POR_ROL = {
  contractor_zurich: ETIQUETA_TRES,
  contractor_alfa: ETIQUETA_TRES,
  contractor_sura: ETIQUETA_TRES,
  contractor_solo_zurich: ETIQUETA_SOLO_ZURICH,
  contractor_solo_bbva: ETIQUETA_SOLO_BBVA,
  contractor_solo_equidad: ETIQUETA_SOLO_EQUIDAD,
  contractor_solo_previsora: ETIQUETA_SOLO_PREVISORA,
  contractor_catastroficos: ETIQUETA_CATASTROFICOS,
};

const SUFIJOS_LEGACY = [
  'Contractor Zurich',
  'Zurich',
  'Alfa',
  'Sura',
  'Zurich, Alfa y Sura',
  'BBVA',
  'Equidad FDM',
  'Previsora',
  'Catastróficos',
];

const APIS_TRES = [
  '/api/zurich',
  '/api/zurich-listado',
  '/api/seguros-alfa',
  '/api/sura',
  '/api/bbva-cat',
  '/api/bbva-cat-listado',
];
const APIS_SOLO_ZURICH = ['/api/zurich'];
const APIS_SOLO_BBVA = ['/api/bbva-cat', '/api/bbva-cat-listado'];
const APIS_SOLO_EQUIDAD = ['/api/equidad-fdm'];
const APIS_SOLO_PREVISORA = [
  '/api/previsora',
  '/api/previsora-listado',
  '/api/tareas',
];
const APIS_CATASTROFICOS = [
  '/api/previsora',
  '/api/previsora-listado',
  '/api/zurich',
  '/api/zurich-listado',
  '/api/bbva-cat',
  '/api/bbva-cat-listado',
  '/api/seguros-alfa',
  '/api/sura',
  '/api/allianz',
  '/api/allianz-listado',
  '/api/historial-formularios',
  '/api/tareas',
];

export const CONTRATISTAS_MODULO = {
  contractor_zurich: {
    apis: APIS_TRES,
    mensaje: 'Su rol solo permite trabajar los módulos Zurich, Alfa, Sura y BBVA.',
  },
  contractor_alfa: {
    apis: APIS_TRES,
    mensaje: 'Su rol solo permite trabajar los módulos Zurich, Alfa, Sura y BBVA.',
  },
  contractor_sura: {
    apis: APIS_TRES,
    mensaje: 'Su rol solo permite trabajar los módulos Zurich, Alfa, Sura y BBVA.',
  },
  contractor_solo_zurich: {
    apis: APIS_SOLO_ZURICH,
    mensaje: 'Su rol Zurich solo permite trabajar el módulo Zurich.',
  },
  contractor_solo_bbva: {
    apis: APIS_SOLO_BBVA,
    mensaje: 'Su rol BBVA solo permite trabajar el módulo BBVA CAT.',
  },
  contractor_solo_equidad: {
    apis: APIS_SOLO_EQUIDAD,
    soloLecturaApi: true,
    mensaje: 'Su rol Equidad solo permite Home, Dashboard y bandeja Fundación de la Mujer (Equidad FDM).',
  },
  contractor_solo_previsora: {
    apis: APIS_SOLO_PREVISORA,
    mensaje: 'Su rol Previsora solo permite Home y el módulo Previsora.',
  },
  contractor_catastroficos: {
    apis: APIS_CATASTROFICOS,
    mensaje: 'Su rol Catastróficos solo permite Previsora, Zurich, BBVA, Alfa, Sura y Allianz.',
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
