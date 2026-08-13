/**
 * Mapeo flexible de encabezados Excel Alfa → campos SegurosAlfaCaso.
 * Claves = encabezado ya normalizado (ver normalizeExcelHeader).
 */

export const ALFA_EXCEL_COLUMN_MAP = Object.freeze({
  siniestro: ['SINIESTRO', 'NUMERO SINIESTRO', 'N SINIESTRO', 'NO SINIESTRO'],
  identificacion: ['IDENTIFICACION', 'CEDULA', 'NIT', 'DOCUMENTO'],
  asegurado: ['ASEGURADO', 'NOMBRE', 'NOMBRE ASEGURADO'],
  tomador: ['TOMADOR'],
  ajustador: ['AJUSTADOR', 'RESPONSABLE', 'LIQUIDADOR AJUSTADOR'],
  numeroPoliza: [
    'NUMERO POLIZA',
    'N POLIZA',
    'NO POLIZA',
    'POLIZA',
    'NUMERO DE POLIZA',
  ],
  direccionPredio: ['DIRECCION PREDIO', 'DIRECCION', 'PREDIO'],
  numeroCredito: [
    'N CREDITO',
    'NUMERO CREDITO',
    'NO CREDITO',
    'CREDITO',
  ],
  informacionContacto: [
    'INFORMACION DE CONTACTO',
    'INFORMACION CONTACTO',
    'CONTACTO',
    'TELEFONO',
  ],
  correo: ['CORREO', 'EMAIL', 'E MAIL'],
  canalRadicacion: ['CANAL DE RADICACION', 'CANAL'],
  ciudad: ['CIUDAD'],
  departamento: ['DEPARTAMENTO'],
  fechaSiniestro: ['FECHA SINIESTRO'],
  fechaInicioPoliza: [
    'FECHA INICIO',
    'FECHA INICIO POLIZA',
    'FECHA INICIO DE LA POLIZA',
    'VIGENCIA DESDE',
    'VIGENCIA INICIO',
  ],
  fechaFinPoliza: [
    'FECHA FIN',
    'FECHA FIN POLIZA',
    'FECHA FIN DE LA POLIZA',
    'VIGENCIA HASTA',
    'VIGENCIA FIN',
  ],
  valorAseguradoInmueble: ['VALOR ASEGURADO INMUEBLE'],
  valorAseguradoContenidos: ['VALOR ASEGURADO CONTENIDOS'],
  cobertura: ['COBERTURA'],
  estadoPagoPrimas: ['ESTADO PAGO PRIMAS'],
  valorReservaPreventivaPromedio: ['VALOR RESERVA PREVENTIVA PROMEDIO'],
  valorComercialInmueble: ['VALOR COMERCIAL INMUEBLE'],
  reserva: ['RESERVA'],
  valorReclamado: ['VALOR RECLAMADO'],
  valorLiquidado: ['VALOR LIQUIDADO'],
  fechaInspeccion: ['FECHA INSPECCION'],
  fechaUltimoDocumento: ['FECHA ULTIMO DOCUMENTO'],
  fechaLiquidado: ['FECHA LIQUIDADO'],
  fechaAceptacionLiquidacion: ['FECHA ACEPTACION LIQUIDACION'],
  fechaEnvioAseguradora: ['FECHA ENVIO A LA ASEGURADORA', 'FECHA ENVIO ASEGURADORA'],
  estado: ['ESTADO', 'ESTADO FINAL'],
});

/** Campos que el Excel puede alimentar (nunca protegidos). */
export const ALFA_EXCEL_UPDATABLE_FIELDS = Object.freeze([
  'siniestro',
  'identificacion',
  'asegurado',
  'tomador',
  'ajustador',
  'numeroPoliza',
  'direccionPredio',
  'numeroCredito',
  'informacionContacto',
  'correo',
  'canalRadicacion',
  'ciudad',
  'departamento',
  'fechaSiniestro',
  'fechaInicioPoliza',
  'fechaFinPoliza',
  'valorAseguradoInmueble',
  'valorAseguradoContenidos',
  'cobertura',
  'estadoPagoPrimas',
  'valorReservaPreventivaPromedio',
  'valorComercialInmueble',
  'reserva',
  'valorReclamado',
  'valorLiquidado',
  'fechaInspeccion',
  'fechaUltimoDocumento',
  'fechaLiquidado',
  'fechaAceptacionLiquidacion',
  'fechaEnvioAseguradora',
  // estado: PROTEGIDO — no se actualiza desde Excel
]);

/**
 * Campos que el Excel NUNCA modifica.
 * Incluye `estado`: el workflow interno de ARNALD no se pisa desde Excel.
 * Si el Excel trae un `estado` distinto, el preview reporta IGNORED_PROTECTED
 * (no se oculta del diff: before/afterExcel + action).
 * `fechaLlamada` es solo ARNALD (formulario/reporte); no entra ni sale por SharePoint.
 */
export const PROTECTED_ALFA_FIELDS = Object.freeze([
  '_id',
  'consecutivo',
  'createdAt',
  'updatedAt',
  'archivos',
  'liquidador',
  'informeUnico',
  'createdBy',
  'estado',
  'fechaLlamada',
  'ubicacionPredio',
  '__v',
]);

/** Campos protegidos visibles en UI/preview (subset de negocio). */
export const ALFA_EXCEL_PROTECTED_VISIBLE_FIELDS = Object.freeze(['estado']);

export const ALFA_EXCEL_DATE_FIELDS = Object.freeze([
  'fechaSiniestro',
  'fechaInicioPoliza',
  'fechaFinPoliza',
  'fechaInspeccion',
  'fechaUltimoDocumento',
  'fechaLiquidado',
  'fechaAceptacionLiquidacion',
  'fechaEnvioAseguradora',
]);

export const ALFA_EXCEL_MONEY_FIELDS = Object.freeze([
  'valorAseguradoInmueble',
  'valorAseguradoContenidos',
  'valorReservaPreventivaPromedio',
  'valorComercialInmueble',
  'reserva',
  'valorReclamado',
  'valorLiquidado',
]);

/** Invertido: header normalizado → campo */
export function buildAlfaExcelHeaderLookup() {
  const lookup = new Map();
  for (const [field, headers] of Object.entries(ALFA_EXCEL_COLUMN_MAP)) {
    for (const h of headers) {
      lookup.set(h, field);
    }
  }
  return lookup;
}
