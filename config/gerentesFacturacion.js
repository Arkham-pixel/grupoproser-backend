/** Claves de gerentes/jefes en el flujo de facturación Complex */
export const GERENTES_FACTURACION = {
  elkin: {
    clave: 'elkin',
    nombre: 'Elkin Tapia Gutiérrez',
    email: 'etapia@proserpuertos.com.co',
    logins: ['72287602'],
  },
  iskharly: {
    clave: 'iskharly',
    nombre: 'Iskharly José Tapia Gutierrez',
    email: 'itapia9@proserpuertos.com.co',
    logins: ['72007205'],
  },
  adriana: {
    clave: 'adriana',
    nombre: 'Adriana Angulo Funes',
    email:
      process.env.EMAIL_FACTURACION_AJUSTES?.trim() ||
      'facturacion.ajustes@proserpuertos.com.co',
    logins: ['1143263277'],
  },
  test: {
    clave: 'test',
    nombre: 'Prueba (danalyst)',
    logins: [],
  },
  /** Líder Zurich: recibe copia de control de horas. No entra al dropdown de Complex. */
  ladys: {
    clave: 'ladys',
    nombre: 'Ladys Andrea Escalante',
    email:
      process.env.EMAIL_LIDER_ZURICH?.trim() ||
      'ladys.escalante@proserpuertos.com.co',
    logins: [],
    soloZurich: true,
  },
};

/** Login/cédula de Ladys Escalante (líder Zurich). */
export const LOGIN_LIDER_ZURICH_FACTURACION = '1041899782';

export const EMAIL_LIDER_ZURICH_FACTURACION =
  process.env.EMAIL_LIDER_ZURICH?.trim() || 'ladys.escalante@proserpuertos.com.co';

/** Supervisor: puede ver la bandeja de todos los jefes (no es jefe). */
export const LOGIN_SUPERVISOR_BANDEJA = '1065012991';

/** Usuarios con acceso de lectura a la bandeja de todos los jefes. */
export const LOGINS_SUPERVISORES_BANDEJA = [
  LOGIN_SUPERVISOR_BANDEJA,
  '1140829957', // Arnaldo Andrés Tapia Gutierrez
];

const LOGIN_A_GERENTE = Object.values(GERENTES_FACTURACION).reduce((acc, g) => {
  g.logins.forEach((login) => {
    acc[String(login).trim()] = g.clave;
  });
  return acc;
}, {});

export function normalizarClaveGerente(gerente) {
  const g = String(gerente || '').trim().toLowerCase();
  if (!g) return null;
  if (GERENTES_FACTURACION[g]) return g;
  if (g.includes('elkin')) return 'elkin';
  if (g.includes('iskharly')) return 'iskharly';
  if (g.includes('adriana') || g.includes('facturacion')) return 'adriana';
  if (g.includes('ladys')) return 'ladys';
  if (g === 'test') return 'test';
  return null;
}

function haystackNombre(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s*\([^)]*\)/g, ' ')
    .trim()
    .toUpperCase();
}

export function esNombreLiderZurichFacturacion(nombre) {
  const hay = haystackNombre(nombre);
  return hay.includes('LADYS') && hay.includes('ESCALANTE');
}

export function esLiderZurichFacturacion({ login, name, email } = {}) {
  if (String(login || '').trim() === LOGIN_LIDER_ZURICH_FACTURACION) return true;
  if (esNombreLiderZurichFacturacion(name)) return true;
  const mail = String(email || '').trim().toLowerCase();
  return Boolean(mail && mail === EMAIL_LIDER_ZURICH_FACTURACION.toLowerCase());
}

/** Bandeja Zurich: líder, jefes de facturación y supervisores. */
export function usuarioPuedeVerBandejaFacturacionZurich({ login, name, email } = {}) {
  if (esSupervisorBandejaFacturacion(login)) return true;
  if (esLiderZurichFacturacion({ login, name, email })) return true;
  const gerente = resolverGerenteDesdeLogin(login);
  return Boolean(gerente && gerente !== 'ladys' && gerente !== 'test');
}

export function resolverGerenteDesdeLogin(login) {
  return LOGIN_A_GERENTE[String(login || '').trim()] || null;
}

export function nombreGerente(clave) {
  const key = normalizarClaveGerente(clave);
  return key ? GERENTES_FACTURACION[key].nombre : clave || '—';
}

export function esSupervisorBandejaFacturacion(login) {
  return LOGINS_SUPERVISORES_BANDEJA.includes(String(login || '').trim());
}

/** Jefes de facturación y supervisores con acceso de lectura. */
export function usuarioPuedeVerBandejaFacturacion({ login }) {
  if (esSupervisorBandejaFacturacion(login)) return true;
  return Boolean(resolverGerenteDesdeLogin(login));
}

/** Puede consultar la bandeja de cualquier jefe (selector). */
export function puedeElegirGerenteEnBandeja(login) {
  return esSupervisorBandejaFacturacion(login);
}

/** Solo Oscar: corregir destinatario o quitar un registro de envío (no borra el caso). */
export function puedeAdministrarBandejaFacturacion(login) {
  return String(login || '').trim() === LOGIN_SUPERVISOR_BANDEJA;
}

export function emailGerente(clave) {
  const key = normalizarClaveGerente(clave);
  return key ? GERENTES_FACTURACION[key].email || '' : '';
}
