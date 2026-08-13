/**
 * Mapping etiquetas Seguros Alfa → documentType ClaimDocument.
 */

const MAP = Object.freeze({
  POLIZA: 'poliza',
  GENERAL: 'general',
  INSPECCION: 'inspeccion',
  FOTOS: 'fotografia',
  LIQUIDACION: 'liquidacion',
  INFORME: 'informe',
  OTRO: 'otro',
});

/**
 * @param {string} etiqueta
 * @returns {{ documentType: string, fallback: boolean, etiqueta: string }}
 */
export function mapAlfaDocumentType(etiqueta) {
  const raw = String(etiqueta || 'GENERAL').trim();
  const key = raw.toUpperCase();
  if (MAP[key]) {
    return { documentType: MAP[key], fallback: false, etiqueta: key };
  }
  console.warn(
    JSON.stringify({
      event: 'DOCUMENT_TYPE_FALLBACK',
      sourceModule: 'alfa',
      etiqueta: raw,
      documentType: 'otro',
    })
  );
  return { documentType: 'otro', fallback: true, etiqueta: key || 'UNKNOWN' };
}

export const ALFA_DOCUMENT_TYPE_MAP = MAP;
