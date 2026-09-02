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
  'contractor_solo_equidad_cat',
  'contractor_solo_express',
  'contractor_solo_previsora',
  'contractor_catastroficos',
  'contractor_era',
];

/** Contratista con acceso únicamente al módulo Zurich. */
export const ROL_SOLO_ZURICH = 'contractor_solo_zurich';

/** Contratista con acceso únicamente al módulo BBVA CAT. */
export const ROL_SOLO_BBVA = 'contractor_solo_bbva';

/** Contratista solo bandeja Equidad FDM (reporte, sin crear/liquidar). */
export const ROL_SOLO_EQUIDAD = 'contractor_solo_equidad';

/** Contratista con acceso únicamente al módulo Equidad CAT. */
export const ROL_SOLO_EQUIDAD_CAT = 'contractor_solo_equidad_cat';

/** Contratista con acceso únicamente al módulo Express. */
export const ROL_SOLO_EXPRESS = 'contractor_solo_express';

/** Contratista solo módulo Previsora (Home + Previsora). */
export const ROL_SOLO_PREVISORA = 'contractor_solo_previsora';

/** Contratista con todos los módulos catastróficos. */
export const ROL_CATASTROFICOS = 'contractor_catastroficos';

/** Contratista ERA: módulos catastróficos sin Equidad FDM. */
export const ROL_ERA = 'contractor_era';

const ETIQUETA_TRES = 'Zurich, Alfa, Sura y BBVA';
const ETIQUETA_SOLO_ZURICH = 'Zurich';
const ETIQUETA_SOLO_BBVA = 'BBVA';
const ETIQUETA_SOLO_EQUIDAD = 'Equidad FDM';
const ETIQUETA_SOLO_EQUIDAD_CAT = 'Equidad CAT';
const ETIQUETA_SOLO_EXPRESS = 'Express';
const ETIQUETA_SOLO_PREVISORA = 'Previsora';
const ETIQUETA_CATASTROFICOS = 'Catastróficos';
const ETIQUETA_ERA = 'ERA';

/** Texto que se agrega al nombre entre paréntesis al asignar el rol. */
export const SUFIJO_NOMBRE_POR_ROL = {
  contractor_zurich: ETIQUETA_TRES,
  contractor_alfa: ETIQUETA_TRES,
  contractor_sura: ETIQUETA_TRES,
  contractor_solo_zurich: ETIQUETA_SOLO_ZURICH,
  contractor_solo_bbva: ETIQUETA_SOLO_BBVA,
  contractor_solo_equidad: ETIQUETA_SOLO_EQUIDAD,
  contractor_solo_equidad_cat: ETIQUETA_SOLO_EQUIDAD_CAT,
  contractor_solo_express: ETIQUETA_SOLO_EXPRESS,
  contractor_solo_previsora: ETIQUETA_SOLO_PREVISORA,
  contractor_catastroficos: ETIQUETA_CATASTROFICOS,
  contractor_era: ETIQUETA_ERA,
};

const SUFIJOS_LEGACY = [
  'Contractor Zurich',
  'Zurich',
  'Alfa',
  'Sura',
  'Zurich, Alfa y Sura',
  'BBVA',
  'Equidad FDM',
  'Equidad CAT',
  'Express',
  'Previsora',
  'Catastróficos',
  'ERA',
];

const APIS_TRES = [
  '/api/zurich',
  '/api/zurich-listado',
  '/api/seguros-alfa',
  '/api/sura',
  '/api/bbva-cat',
  '/api/bbva-cat-listado',
  '/api/agenda-catastrofico',
];
const APIS_SOLO_ZURICH = ['/api/zurich', '/api/zurich-listado', '/api/agenda-catastrofico'];
const APIS_SOLO_BBVA = ['/api/bbva-cat', '/api/bbva-cat-listado', '/api/agenda-catastrofico'];
const APIS_SOLO_EQUIDAD = ['/api/equidad-fdm'];
const APIS_SOLO_EQUIDAD_CAT = ['/api/equidad-cat', '/api/arnald-drafts', '/api/agenda-catastrofico'];
const APIS_SOLO_EXPRESS = [
  '/api/siniestros-express',
  '/api/arnald-drafts',
  '/api/alertas/protocolo',
];
const APIS_SOLO_PREVISORA = [
  '/api/previsora',
  '/api/previsora-listado',
  '/api/tareas',
  '/api/agenda-catastrofico',
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
  '/api/equidad-cat',
  '/api/historial-formularios',
  '/api/tareas',
  '/api/agenda-catastrofico',
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
  contractor_solo_equidad_cat: {
    apis: APIS_SOLO_EQUIDAD_CAT,
    mensaje: 'Su rol Equidad CAT solo permite trabajar el módulo Equidad CAT.',
  },
  contractor_solo_express: {
    apis: APIS_SOLO_EXPRESS,
    mensaje: 'Su rol Express solo permite trabajar el módulo Express.',
  },
  contractor_solo_previsora: {
    apis: APIS_SOLO_PREVISORA,
    mensaje: 'Su rol Previsora solo permite Home y el módulo Previsora.',
  },
  contractor_catastroficos: {
    apis: APIS_CATASTROFICOS,
    mensaje: 'Su rol Catastróficos solo permite Previsora, Zurich, BBVA, Alfa, Sura, Allianz y Equidad CAT.',
  },
  contractor_era: {
    apis: APIS_CATASTROFICOS,
    mensaje: 'Su rol ERA solo permite Previsora, Zurich, BBVA, Alfa, Sura, Allianz y Equidad CAT.',
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
