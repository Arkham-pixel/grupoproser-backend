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
};

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
  if (g === 'test') return 'test';
  return null;
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
