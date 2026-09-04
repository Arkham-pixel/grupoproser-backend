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
  celular: ['CELULAR', 'CELULAR ASEGURADO', 'TELEFONO CELULAR', 'MOVIL', 'WHATSAPP'],
  canalRadicacion: ['CANAL DE RADICACION', 'CANAL'],
  ciudad: ['CIUDAD'],
  departamento: ['DEPARTAMENTO'],
  fechaSiniestro: ['FECHA SINIESTRO'],
  fechaAviso: ['FECHA AVISO', 'FECHA DE AVISO', 'FECHA AVISO SINIESTRO'],
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
  valorAseguradoSid: ['VALOR ASEGURADO SID', 'VALOR ASEGURADO S I D', 'VA SID'],
  valorAseguradoInmueble: ['VALOR ASEGURADO INMUEBLE'],
  valorAseguradoContenidos: ['VALOR ASEGURADO CONTENIDOS'],
  cobertura: ['COBERTURA'],
  estadoPagoPrimas: ['ESTADO PAGO PRIMAS'],
  valorReservaPreventivaPromedio: [
    'VALOR RESERVA PREVENTIVA PROMEDIO',
    'VALOR RESERVA ACTUARIAL',
    'RESERVA ACTUARIAL',
  ],
  valorComercialInmueble: ['VALOR COMERCIAL INMUEBLE'],
  reserva: ['RESERVA'],
  valorReclamado: ['VALOR RECLAMADO'],
  valorLiquidado: ['VALOR LIQUIDADO'],
  liquidadoCoberturaTerremo: ['LIQUIDADO COBERTURA TERREMOTO'],
  deducibleTerremoto: ['DEDUCIBLE TERREMOTO'],
  valorLiquidacionCoberturasAdicionales: [
    'VALOR LIQUIDACION COBERTURAS ADICIONALES',
    'VALOR LIQUIDACIÓN COBERTURAS ADICIONALES',
  ],
  deducibleCoberturasAdicionales: ['DEDUCIBLE COBERTURAS ADICIONALES'],
  valorTotalPagar: ['VALOR TOTAL A PAGAR'],
  fechaInspeccion: ['FECHA INSPECCION'],
  fechaUltimoDocumento: ['FECHA ULTIMO DOCUMENTO'],
  fechaLiquidado: ['FECHA LIQUIDADO'],
  fechaAceptacionLiquidacion: ['FECHA ACEPTACION LIQUIDACION'],
  fechaEnvioAseguradora: ['FECHA ENVIO A LA ASEGURADORA', 'FECHA ENVIO ASEGURADORA'],
  /** Estado siniestro (workflow). */
  estado: ['ESTADO SINIESTRO', 'ESTADO FINAL', 'ESTADO'],
  /** Estado de gestión operativo (correo Alfa). */
  estadoGestion: ['ESTADO GESTION', 'ESTADO DE GESTION'],
  zonaAsignada: ['ZONA', 'ZONA ASIGNADA', 'TERRITORIO'],
  observacionesGestion: [
    'OBSERVACION',
    'OBSERVACIONES',
    'OBSERVACIONES GESTION',
    'OBSERVACION GESTION',
  ],
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
  'celular',
  'canalRadicacion',
  'ciudad',
  'departamento',
  'fechaSiniestro',
  'fechaAviso',
  'fechaInicioPoliza',
  'fechaFinPoliza',
  'valorAseguradoSid',
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
  // estado / estadoGestion: PROTEGIDOS — ARNALD → Excel (outbound)
]);

/**
 * Campos que el Excel NUNCA modifica.
 * `estado` y `estadoGestion` los escribe ARNALD (outbound amarillas).
 * `fechaLlamada` y `observacionLlamada` son solo ARNALD.
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
  'estadoGestion',
  'observacionesGestion',
  'fechaLlamada',
  'observacionLlamada',
  'liquidadoCoberturaTerremo',
  'deducibleTerremoto',
  'valorLiquidacionCoberturasAdicionales',
  'deducibleCoberturasAdicionales',
  'valorTotalPagar',
  'ubicacionPredio',
  'casoPadreId',
  'grupoReclamacion',
  'fueraDeZona',
  '__v',
]);

/** Campos protegidos visibles en UI/preview (subset de negocio). */
export const ALFA_EXCEL_PROTECTED_VISIBLE_FIELDS = Object.freeze([
  'estado',
  'estadoGestion',
]);

export const ALFA_EXCEL_DATE_FIELDS = Object.freeze([
  'fechaSiniestro',
  'fechaAviso',
  'fechaInicioPoliza',
  'fechaFinPoliza',
  'fechaInspeccion',
  'fechaUltimoDocumento',
  'fechaLiquidado',
  'fechaAceptacionLiquidacion',
  'fechaEnvioAseguradora',
]);

export const ALFA_EXCEL_MONEY_FIELDS = Object.freeze([
  'valorAseguradoSid',
  'valorAseguradoInmueble',
  'valorAseguradoContenidos',
  'valorReservaPreventivaPromedio',
  'valorComercialInmueble',
  'reserva',
  'valorReclamado',
  'valorLiquidado',
  'liquidadoCoberturaTerremo',
  'deducibleTerremoto',
  'valorLiquidacionCoberturasAdicionales',
  'deducibleCoberturasAdicionales',
  'valorTotalPagar',
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
