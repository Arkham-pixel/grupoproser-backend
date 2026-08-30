/** Causa por defecto de la cartera Zurich (evento CAT terremoto). */
export const CAUSA_ZURICH_DEFAULT = 'TERREMOTO';

function claveCausa(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/**
 * Unifica vacíos y variantes (Terremoto / TERREMOTO / sismo) en TERREMOTO.
 * Esta cartera Zurich es el evento CAT; si no hay causa, es terremoto.
 */
export function homologarCausaZurich(valor) {
  const texto = String(valor ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const clave = claveCausa(texto);
  if (!clave) return CAUSA_ZURICH_DEFAULT;
  if (
    clave === 'TERREMOTO' ||
    clave === 'SISMO' ||
    clave === 'SEISMO' ||
    clave === 'EARTHQUAKE' ||
    clave === 'TEMBLOR' ||
    /\bTERREMOTO\b/.test(clave) ||
    /\bSISMO\b/.test(clave) ||
    clave.includes('MOVIMIENTO TELURICO') ||
    clave.includes('MOVIMIENTO SISMICO')
  ) {
    return CAUSA_ZURICH_DEFAULT;
  }
  return texto;
}

export function causaZurichVaciaOTerremoto(valor) {
  return homologarCausaZurich(valor) === CAUSA_ZURICH_DEFAULT;
}
