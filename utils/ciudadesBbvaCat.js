/** Unifica Cali / Santiago de Cali → CALI. */
export function homologarCiudadBbvaCat(valor) {
  const texto = String(valor ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!texto) return '';
  const clave = texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (
    clave === 'CALI' ||
    clave === 'CALI VALLE' ||
    clave === 'CALI VALLE DEL CAUCA' ||
    /^SANTIAGO DE CALI\b/.test(clave)
  ) {
    return 'CALI';
  }
  return texto;
}

export const homologarCiudadZurich = homologarCiudadBbvaCat;
