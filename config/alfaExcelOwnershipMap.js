/**
 * Ownership Excel Control y Seguimiento (hoja BD) — consolidado FAC-Cali operativo (sin _Final).
 * Amarillas (ARNALD outbound): T–AD según encabezados reales del archivo.
 * Verdes (Alfa inbound): A–S.
 *
 * REGLA: nunca crear columnas nuevas. Solo escribir columnas que YA existen.
 * La letra es referencia; el outbound debe resolver también por encabezado.
 */

export const ALFA_EXCEL_SHEET_NAME = 'BD';
export const ALFA_EXCEL_HEADER_ROW = 1;

/**
 * @typedef {{ owner: 'alfa'|'arnald', column: string, header: string, outboundEnabled?: boolean, headerAliases?: string[] }} OwnershipEntry
 */

/** @type {Readonly<Record<string, OwnershipEntry>>} */
export const ALFA_EXCEL_OWNERSHIP = Object.freeze({
  // —— Alfa (verde) — no writable ——
  fechaAviso: { owner: 'alfa', column: 'A', header: 'FECHA AVISO' },
  siniestro: { owner: 'alfa', column: 'B', header: 'SINIESTRO' },
  identificacion: { owner: 'alfa', column: 'C', header: 'IDENTIFICACIÓN' },
  asegurado: { owner: 'alfa', column: 'D', header: 'ASEGURADO' },
  tomador: { owner: 'alfa', column: 'E', header: 'TOMADOR' },
  numeroPoliza: { owner: 'alfa', column: 'F', header: 'N° PÓLIZA' },
  direccionPredio: { owner: 'alfa', column: 'G', header: 'DIRECCIÓN PREDIO' },
  numeroCredito: { owner: 'alfa', column: 'H', header: 'N CRÉDITO' },
  informacionContacto: { owner: 'alfa', column: 'I', header: 'INFORMACION DE CONTACTO' },
  correo: { owner: 'alfa', column: 'J', header: 'CORREO' },
  ciudad: { owner: 'alfa', column: 'K', header: 'CIUDAD' },
  departamento: { owner: 'alfa', column: 'L', header: 'DEPARTAMENTO' },
  fechaSiniestro: { owner: 'alfa', column: 'M', header: 'FECHA SINIESTRO' },
  valorAseguradoSid: { owner: 'alfa', column: 'N', header: 'VALOR ASEGURADO SID' },
  valorAseguradoInmueble: { owner: 'alfa', column: 'O', header: 'VALOR ASEGURADO INMUEBLE' },
  valorAseguradoContenidos: { owner: 'alfa', column: 'P', header: 'VALOR ASEGURADO CONTENIDOS' },
  cobertura: { owner: 'alfa', column: 'Q', header: 'COBERTURA' },
  estadoPagoPrimas: { owner: 'alfa', column: 'R', header: 'ESTADO PAGO PRIMAS' },
  canalRadicacion: { owner: 'alfa', column: 'S', header: 'CANAL DE RADICACIÓN' },

  // —— ARNALD (amarillo) — outbound T–AD ——
  valorReservaPreventivaPromedio: {
    owner: 'arnald',
    column: 'T',
    header: 'VALOR RESERVA ACTUARIAL',
    headerAliases: ['VALOR RESERVA PREVENTIVA PROMEDIO', 'VALOR RESERVA ACTUARIAL'],
    outboundEnabled: true,
  },
  valorComercialInmueble: {
    owner: 'arnald',
    column: 'U',
    header: 'VALOR COMERCIAL INMUEBLE',
    outboundEnabled: true,
  },
  reserva: {
    owner: 'arnald',
    column: 'V',
    header: 'RESERVA',
    outboundEnabled: true,
  },
  valorReclamado: {
    owner: 'arnald',
    column: 'W',
    header: 'VALOR RECLAMADO',
    outboundEnabled: true,
  },
  valorLiquidado: {
    owner: 'arnald',
    column: 'X',
    header: 'VALOR LIQUIDADO',
    outboundEnabled: true,
  },
  fechaInspeccion: {
    owner: 'arnald',
    column: 'Y',
    header: 'FECHA INSPECCIÓN',
    outboundEnabled: true,
  },
  fechaUltimoDocumento: {
    owner: 'arnald',
    column: 'Z',
    header: 'FECHA ULTIMO DOCUMENTO',
    outboundEnabled: true,
  },
  fechaLiquidado: {
    owner: 'arnald',
    column: 'AA',
    header: 'FECHA LIQUIDADO',
    outboundEnabled: true,
  },
  fechaAceptacionLiquidacion: {
    owner: 'arnald',
    column: 'AB',
    header: 'FECHA ACEPTACIÓN LIQUIDACIÓN',
    outboundEnabled: true,
  },
  fechaEnvioAseguradora: {
    owner: 'arnald',
    column: 'AC',
    header: 'FECHA ENVÍO A LA ASEGURADORA',
    outboundEnabled: true,
  },
  estadoGestion: {
    owner: 'arnald',
    column: 'AD',
    header: 'ESTADO GESTION',
    headerAliases: ['ESTADO GESTION', 'ESTADO DE GESTION'],
    outboundEnabled: true,
  },
  estado: {
    owner: 'arnald',
    column: 'AE',
    header: 'ESTADO SINIESTRO',
    headerAliases: ['ESTADO SINIESTRO', 'ESTADO'],
    outboundEnabled: true,
  },
  observacionesGestion: {
    owner: 'arnald',
    column: 'AF',
    header: 'OBSERVACION',
    headerAliases: ['OBSERVACION', 'OBSERVACIONES', 'OBSERVACIONES GESTION'],
    outboundEnabled: true,
  },
});

/** Columnas verdes (A–S) — solo lectura para outbound. */
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
  'R',
  'S',
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

/** Campos amarillos con escritura outbound activa. */
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
}
