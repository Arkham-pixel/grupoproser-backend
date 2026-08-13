/**
 * Ownership Excel Control y Seguimiento (hoja BD).
 * Basado en colores reales del archivo Alfa:
 *   Verde #92D050 → Alfa (inbound only)
 *   Amarillo #FFFF00 → ARNALD (outbound allowlist R–AB)
 *
 * REGLA: nunca crear columnas nuevas. Solo escribir columnas que YA existen.
 */

export const ALFA_EXCEL_SHEET_NAME = 'BD';
export const ALFA_EXCEL_HEADER_ROW = 1;

/**
 * @typedef {{ owner: 'alfa'|'arnald', column: string, header: string, outboundEnabled?: boolean }} OwnershipEntry
 */

/** @type {Readonly<Record<string, OwnershipEntry>>} */
export const ALFA_EXCEL_OWNERSHIP = Object.freeze({
  // —— Alfa (verde) — no writable ——
  siniestro: { owner: 'alfa', column: 'A', header: 'SINIESTRO' },
  identificacion: { owner: 'alfa', column: 'B', header: 'IDENTIFICACIÓN' },
  asegurado: { owner: 'alfa', column: 'C', header: 'ASEGURADO' },
  tomador: { owner: 'alfa', column: 'D', header: 'TOMADOR' },
  numeroPoliza: { owner: 'alfa', column: 'E', header: 'N° PÓLIZA' },
  direccionPredio: { owner: 'alfa', column: 'F', header: 'DIRECCIÓN PREDIO' },
  numeroCredito: { owner: 'alfa', column: 'G', header: 'N CRÉDITO' },
  informacionContacto: { owner: 'alfa', column: 'H', header: 'INFORMACION DE CONTACTO' },
  correo: { owner: 'alfa', column: 'I', header: 'CORREO' },
  ciudad: { owner: 'alfa', column: 'J', header: 'CIUDAD' },
  departamento: { owner: 'alfa', column: 'K', header: 'DEPARTAMENTO' },
  fechaSiniestro: { owner: 'alfa', column: 'L', header: 'FECHA SINIESTRO' },
  valorAseguradoInmueble: { owner: 'alfa', column: 'M', header: 'VALOR ASEGURADO INMUEBLE' },
  valorAseguradoContenidos: { owner: 'alfa', column: 'N', header: 'VALOR ASEGURADO CONTENIDOS' },
  cobertura: { owner: 'alfa', column: 'O', header: 'COBERTURA' },
  estadoPagoPrimas: { owner: 'alfa', column: 'P', header: 'ESTADO PAGO PRIMAS' },
  canalRadicacion: { owner: 'alfa', column: 'Q', header: 'CANAL DE RADICACIÓN' },

  // —— ARNALD (amarillo) — outbound R–AB completo ——
  valorReservaPreventivaPromedio: {
    owner: 'arnald',
    column: 'R',
    header: 'VALOR RESERVA PREVENTIVA PROMEDIO',
    outboundEnabled: true,
  },
  valorComercialInmueble: {
    owner: 'arnald',
    column: 'S',
    header: 'VALOR COMERCIAL INMUEBLE',
    outboundEnabled: true,
  },
  reserva: {
    owner: 'arnald',
    column: 'T',
    header: 'RESERVA',
    outboundEnabled: true,
  },
  valorReclamado: {
    owner: 'arnald',
    column: 'U',
    header: 'VALOR RECLAMADO',
    outboundEnabled: true,
  },
  valorLiquidado: {
    owner: 'arnald',
    column: 'V',
    header: 'VALOR LIQUIDADO',
    outboundEnabled: true,
  },
  fechaInspeccion: {
    owner: 'arnald',
    column: 'W',
    header: 'FECHA INSPECCIÓN',
    outboundEnabled: true,
  },
  fechaUltimoDocumento: {
    owner: 'arnald',
    column: 'X',
    header: 'FECHA ULTIMO DOCUMENTO',
    outboundEnabled: true,
  },
  fechaLiquidado: {
    owner: 'arnald',
    column: 'Y',
    header: 'FECHA LIQUIDADO',
    outboundEnabled: true,
  },
  fechaAceptacionLiquidacion: {
    owner: 'arnald',
    column: 'Z',
    header: 'FECHA ACEPTACIÓN LIQUIDACIÓN',
    outboundEnabled: true,
  },
  fechaEnvioAseguradora: {
    owner: 'arnald',
    column: 'AA',
    header: 'FECHA ENVÍO A LA ASEGURADORA',
    outboundEnabled: true,
  },
  estado: {
    owner: 'arnald',
    column: 'AB',
    header: 'ESTADO',
    outboundEnabled: true,
  },
});

/** Columnas verdes (A–Q) — solo lectura para outbound. */
export const ALFA_EXCEL_GREEN_COLUMNS = Object.freeze([
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
]);

export function getOwnershipEntry(field) {
  return ALFA_EXCEL_OWNERSHIP[field] || null;
}

export function isAlfaOwnedField(field) {
  return getOwnershipEntry(field)?.owner === 'alfa';
}

export function isArnaldOwnedField(field) {
  return getOwnershipEntry(field)?.owner === 'arnald';
}

/** Campos amarillos con escritura outbound activa (R–AB). */
export function getOutboundWritableFields() {
  return Object.entries(ALFA_EXCEL_OWNERSHIP)
    .filter(([, e]) => e.owner === 'arnald' && e.outboundEnabled === true && e.column)
    .map(([field]) => field);
}

/**
 * Filtra changes para outbox.
 * - owner alfa → ALFA_EXCEL_FIELD_NOT_WRITABLE (descartado)
 * - sin columna / no arnald → OUTBOUND_FIELD_NOT_MAPPED
 * - arnald writable → incluido
 */
export function filterOutboundWritableChanges(changes = {}) {
  const writable = {};
  const rejected = [];

  for (const [field, diff] of Object.entries(changes || {})) {
    const entry = getOwnershipEntry(field);
    if (!entry) {
      rejected.push({
        field,
        code: 'OUTBOUND_FIELD_NOT_MAPPED',
        reason: 'sin columna en plantilla Alfa',
      });
      continue;
    }
    if (entry.owner === 'alfa') {
      rejected.push({
        field,
        code: 'ALFA_EXCEL_FIELD_NOT_WRITABLE',
        reason: 'propiedad Alfa',
      });
      continue;
    }
    if (entry.owner !== 'arnald' || !entry.column || entry.outboundEnabled !== true) {
      rejected.push({
        field,
        code: 'OUTBOUND_FIELD_NOT_MAPPED',
        reason:
          entry.outboundEnabled === false
            ? 'columna amarilla no habilitada'
            : 'sin columna outbound',
      });
      continue;
    }
    writable[field] = {
      ...diff,
      column: entry.column,
      header: entry.header,
    };
  }

  return { writable, rejected };
}

export function assertFieldWritableOrThrow(field) {
  const entry = getOwnershipEntry(field);
  if (!entry || entry.owner !== 'arnald' || entry.outboundEnabled !== true || !entry.column) {
    const err = new Error(`ALFA_EXCEL_FIELD_NOT_WRITABLE: ${field}`);
    err.code = 'ALFA_EXCEL_FIELD_NOT_WRITABLE';
    throw err;
  }
  return entry;
}
