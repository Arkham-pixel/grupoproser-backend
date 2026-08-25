/**
 * Guardas de sync Excel ↔ ARNALD (Equidad FDM).
 * Evitan: borrar ciudades, crear duplicados infinitos, mezclar Lorica con terremoto.
 */

export const soloDigitosFdm = (valor) => String(valor ?? '').replace(/\D/g, '');

export const esMunicipioVacioOBasura = (valor) => {
  if (valor == null || valor === '') return true;
  if (typeof valor === 'number' && valor === 0) return true;
  const t = String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!t) return true;
  return /^(0|N\/?A|NA|NULL|UNDEFINED|-|S\/I|SIN DATO|SIN INFO|SIN INFORMACION|SIN CIUDAD|SIN MUNICIPIO)$/i.test(
    t
  );
};

export const esMunicipioLorica = (valor) => {
  const t = String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  return t === 'LORICA' || t.includes('LORICA');
};

export const esCasoLoricaOFueraTerremoto = (caso = {}) => {
  if (esMunicipioLorica(caso.municipio)) return true;
  const ev = String(caso.evento ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  if (!ev) return true;
  if (ev.includes('TERREMOTO') || ev.includes('TEMBLOR')) return false;
  return true;
};

const polizaNormFdm = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

const esTerremotoFdm = (caso = {}) => {
  const ev = String(caso.evento ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return ev.includes('TERREMOTO') || ev.includes('TEMBLOR');
};

/**
 * Antes de CREATE desde Excel terremoto: MATCH / REJECT / CREATE.
 * Misma cédula + misma póliza → MATCH.
 * Misma cédula + distinta póliza → CREATE (dos casos).
 * @returns {{ action: 'MATCH'|'REJECT'|'CREATE', caso?: object, reason?: string }}
 */
export const decidirAltaDesdeExcelTerremoto = (fila = {}, existentes = []) => {
  if (esMunicipioLorica(fila.municipio)) {
    return {
      action: 'REJECT',
      reason: 'Fila Lorica: no se mezcla con base terremoto',
    };
  }

  const ced = soloDigitosFdm(fila.cedula);
  if (!ced || ced.length < 6) {
    return { action: 'CREATE' };
  }

  const polFila = polizaNormFdm(fila.polizaAfectar);
  const mismosCed = existentes.filter((c) => soloDigitosFdm(c.cedula) === ced);
  if (!mismosCed.length) return { action: 'CREATE' };

  const terremotos = mismosCed.filter(esTerremotoFdm);

  // Misma cédula + misma póliza (ambas con valor, o ambas vacías).
  const matchExacto = terremotos.find((c) => {
    const pol = polizaNormFdm(c.polizaAfectar);
    if (polFila && pol) return pol === polFila;
    if (!polFila && !pol) return true;
    return false;
  });
  if (matchExacto) return { action: 'MATCH', caso: matchExacto };

  // Ya hay terremoto(s) con otra póliza o con póliza cuando la fila no trae → CREATE.
  if (terremotos.length) return { action: 'CREATE' };

  const lorica = mismosCed.find((c) => esCasoLoricaOFueraTerremoto(c));
  if (lorica) {
    return {
      action: 'REJECT',
      reason: `Ya existe en ARNALD fuera de terremoto (${lorica.consecutivo || lorica._id}); no crear duplicado`,
      caso: lorica,
    };
  }

  return { action: 'CREATE' };
};
