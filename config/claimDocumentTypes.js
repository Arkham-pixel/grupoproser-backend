/**
 * Tipos documentales de siniestro → carpeta SharePoint (réplica).
 * El frontend solo envía `key`; nunca una ruta SharePoint libre.
 */

export const DOCUMENT_TYPES = Object.freeze({
  reclamacion: {
    key: 'reclamacion',
    label: 'Reclamación',
    sharepointFolder: '01_RECLAMACION',
  },
  poliza: {
    key: 'poliza',
    label: 'Póliza',
    sharepointFolder: '02_POLIZA',
  },
  general: {
    key: 'general',
    label: 'General',
    sharepointFolder: 'GENERAL',
  },
  inspeccion: {
    key: 'inspeccion',
    label: 'Inspección',
    sharepointFolder: '03_INSPECCION',
  },
  fotografia: {
    key: 'fotografia',
    label: 'Fotografías',
    sharepointFolder: '04_FOTOGRAFIAS',
  },
  cotizacion: {
    key: 'cotizacion',
    label: 'Cotizaciones',
    sharepointFolder: '05_COTIZACIONES',
  },
  soporte: {
    key: 'soporte',
    label: 'Soportes',
    sharepointFolder: '06_SOPORTES',
  },
  correspondencia: {
    key: 'correspondencia',
    label: 'Correspondencia',
    sharepointFolder: '07_CORRESPONDENCIA',
  },
  informe: {
    key: 'informe',
    label: 'Informes',
    sharepointFolder: '08_INFORMES',
  },
  liquidacion: {
    key: 'liquidacion',
    label: 'Liquidación',
    sharepointFolder: '09_LIQUIDACION',
  },
  otro: {
    key: 'otro',
    label: 'Otro',
    sharepointFolder: 'OTRO',
  },
});

export const DOCUMENT_TYPE_KEYS = Object.freeze(Object.keys(DOCUMENT_TYPES));

export function isValidDocumentType(key) {
  return Boolean(DOCUMENT_TYPES[String(key || '').trim()]);
}

export function getDocumentTypeConfig(key) {
  const cfg = DOCUMENT_TYPES[String(key || '').trim()];
  if (!cfg) {
    const err = new Error(`documentType no permitido: ${key}`);
    err.code = 'INVALID_DOCUMENT_TYPE';
    throw err;
  }
  return cfg;
}

export function getSharePointFolderForDocumentType(key) {
  return getDocumentTypeConfig(key).sharepointFolder;
}
