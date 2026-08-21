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

/**
 * Antes de CREATE desde Excel terremoto: MATCH / REJECT / CREATE.
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

  const mismos = existentes.filter((c) => soloDigitosFdm(c.cedula) === ced);
  if (!mismos.length) return { action: 'CREATE' };

  const terremoto = mismos.find((c) => {
    const ev = String(c.evento ?? '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return ev.includes('TERREMOTO') || ev.includes('TEMBLOR');
  });
  if (terremoto) {
    return { action: 'MATCH', caso: terremoto };
  }

  const lorica = mismos.find((c) => esCasoLoricaOFueraTerremoto(c));
  if (lorica) {
    return {
      action: 'REJECT',
      reason: `Ya existe en ARNALD fuera de terremoto (${lorica.consecutivo || lorica._id}); no crear duplicado`,
      caso: lorica,
    };
  }

  return {
    action: 'REJECT',
    reason: `Ya existe cédula ${ced} en ARNALD; no crear caso infinito`,
    caso: mismos[0],
  };
};
