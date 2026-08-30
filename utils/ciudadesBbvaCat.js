function claveCiudad(valor) {
  return String(valor ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Departamento DANE → capital (nombres del catálogo gsk3cAppciudades). */
const CAPITAL_POR_DEPTO = {
  'VALLE DEL CAUCA': { depto: 'VALLE DEL CAUCA', capital: 'CALI' },
  QUINDIO: { depto: 'QUINDIO', capital: 'ARMENIA' },
  RISARALDA: { depto: 'RISARALDA', capital: 'PEREIRA' },
  CALDAS: { depto: 'CALDAS', capital: 'MANIZALES' },
  CAUCA: { depto: 'CAUCA', capital: 'POPAYAN' },
  CHOCO: { depto: 'CHOCO', capital: 'QUIBDO' },
  TOLIMA: { depto: 'TOLIMA', capital: 'IBAGUE' },
  HUILA: { depto: 'HUILA', capital: 'NEIVA' },
  CAQUETA: { depto: 'CAQUETA', capital: 'FLORENCIA' },
  SANTANDER: { depto: 'SANTANDER', capital: 'BUCARAMANGA' },
  ANTIOQUIA: { depto: 'ANTIOQUIA', capital: 'MEDELLIN' },
  ATLANTICO: { depto: 'ATLANTICO', capital: 'BARRANQUILLA' },
  BOLIVAR: { depto: 'BOLIVAR', capital: 'CARTAGENA' },
  BOYACA: { depto: 'BOYACA', capital: 'TUNJA' },
  CESAR: { depto: 'CESAR', capital: 'VALLEDUPAR' },
  CORDOBA: { depto: 'CORDOBA', capital: 'MONTERIA' },
  CUNDINAMARCA: { depto: 'CUNDINAMARCA', capital: '' },
  MAGDALENA: { depto: 'MAGDALENA', capital: 'SANTA MARTA' },
  META: { depto: 'META', capital: 'VILLAVICENCIO' },
  NARINO: { depto: 'NARINO', capital: 'PASTO' },
  'NORTE DE SANTANDER': { depto: 'NORTE DE SANTANDER', capital: 'CUCUTA' },
  SUCRE: { depto: 'SUCRE', capital: 'SINCELEJO' },
  PUTUMAYO: { depto: 'PUTUMAYO', capital: 'MOCOA' },
  ARAUCA: { depto: 'ARAUCA', capital: 'ARAUCA' },
  CASANARE: { depto: 'CASANARE', capital: 'YOPAL' },
  AMAZONAS: { depto: 'AMAZONAS', capital: 'LETICIA' },
  GUAINIA: { depto: 'GUAINIA', capital: 'INIRIDA' },
  GUAVIARE: { depto: 'GUAVIARE', capital: 'SAN JOSE DEL GUAVIARE' },
  VAUPES: { depto: 'VAUPES', capital: 'MITU' },
  VICHADA: { depto: 'VICHADA', capital: 'PUERTO CARRENO' },
  'LA GUAJIRA': { depto: 'LA GUAJIRA', capital: 'RIOHACHA' },
  'BOGOTA D C': { depto: 'BOGOTA, D.C.', capital: 'BOGOTA, D.C.' },
  BOGOTA: { depto: 'BOGOTA, D.C.', capital: 'BOGOTA, D.C.' },
};

const DEPTO_POR_MUNICIPIO = {
  CALI: 'VALLE DEL CAUCA',
  BUGA: 'VALLE DEL CAUCA',
  BUENAVENTURA: 'VALLE DEL CAUCA',
  TULUA: 'VALLE DEL CAUCA',
  PALMIRA: 'VALLE DEL CAUCA',
  JAMUNDI: 'VALLE DEL CAUCA',
  YUMBO: 'VALLE DEL CAUCA',
  PEREIRA: 'RISARALDA',
  DOSQUEBRADAS: 'RISARALDA',
  'SANTA ROSA DE CABAL': 'RISARALDA',
  ARMENIA: 'QUINDIO',
  CALARCA: 'QUINDIO',
  MANIZALES: 'CALDAS',
  POPAYAN: 'CAUCA',
  QUIBDO: 'CHOCO',
  IBAGUE: 'TOLIMA',
  NEIVA: 'HUILA',
  FLORENCIA: 'CAQUETA',
  BUCARAMANGA: 'SANTANDER',
  MEDELLIN: 'ANTIOQUIA',
  'BOGOTA D C': 'BOGOTA, D.C.',
  BOGOTA: 'BOGOTA, D.C.',
  FACATATIVA: 'CUNDINAMARCA',
};

/** Unifica Cali / Pereira / Bogotá y variantes de Excel. */
export function homologarCiudadCatastrofico(valor) {
  const texto = String(valor ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!texto) return '';
  const clave = claveCiudad(texto);
  if (
    clave === 'CALI' ||
    clave === 'CALI VALLE' ||
    clave === 'CALI VALLE DEL CAUCA' ||
    /^SANTIAGO DE CALI\b/.test(clave)
  ) {
    return 'CALI';
  }
  if (clave === 'PEREIRA' || clave === 'PEREIRA RISARALDA') {
    return 'PEREIRA';
  }
  if (clave === 'BOGOTA' || clave === 'BOGOTA D C' || clave === 'SANTAFE DE BOGOTA') {
    return 'BOGOTA, D.C.';
  }
  return texto;
}

export function esDepartamentoColombia(valor) {
  const clave = claveCiudad(valor);
  if (!clave) return false;
  if (DEPTO_POR_MUNICIPIO[clave] && !CAPITAL_POR_DEPTO[clave]) return false;
  return Boolean(CAPITAL_POR_DEPTO[clave]);
}

/**
 * Si el Excel puso un departamento en «ciudad», lo pasa a departamento
 * y deja la capital en ciudad (Valle del Cauca → CALI).
 */
export function resolverUbicacionCatastrofico(ciudad, departamento = '') {
  const deptoIn = String(departamento ?? '').trim();
  const ciudadHom = homologarCiudadCatastrofico(ciudad);
  const clave = claveCiudad(ciudadHom);
  const deptoHit = CAPITAL_POR_DEPTO[clave];
  if (deptoHit) {
    return {
      ciudad: deptoHit.capital || '',
      departamento: deptoIn || deptoHit.depto,
    };
  }
  const deptoMun = DEPTO_POR_MUNICIPIO[clave];
  return {
    ciudad: ciudadHom,
    departamento: deptoIn || deptoMun || '',
  };
}

export const homologarCiudadBbvaCat = homologarCiudadCatastrofico;
export const homologarCiudadZurich = homologarCiudadCatastrofico;
export const homologarCiudadAllianz = (valor) =>
  resolverUbicacionCatastrofico(valor).ciudad || homologarCiudadCatastrofico(valor);
