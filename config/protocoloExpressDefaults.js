/**
 * ANS / protocolo de tiempos — siniestros Express.
 * Plazos en días hábiles Colombia (festivos + fines de semana).
 * Etapas alineadas a las fechas oficiales Express (correo julio 2026).
 */

export const PROTOCOLO_EXPRESS_VERSION = '2026-08-04-reconsideracion-opcional';
export const PROTOCOLO_EXPRESS_FECHA_ACTIVACION = '2026-07-24';
export const PROTOCOLO_EXPRESS_DOCUMENTO =
  'ANS Express — fechas oficiales (julio 2026)';

/**
 * Estados Express sin alertas ANS.
 * 2 DESISTIDO · 8 TRAMITADO A COMPLEX
 */
export const CODIGOS_ESTADO_EXPRESS_SIN_ALERTAS = ['2', '8', 2, 8];

/** @type {import('./protocoloSiniestrosDefaults.js').EtapaProtocolo[]} */
export const ETAPAS_PROTOCOLO_EXPRESS_DEFAULT = [
  {
    id: 'solicitudInicialDocs',
    fase: 1,
    nombre: 'Solicitud inicial de documentos',
    actividad: 'Realizar la solicitud inicial de documentos',
    campoFecha: 'fechaSolicitudDocumentos',
    campoDoc: null,
    referencia: 'avisoSiniestro',
    referenciaAlternativa: 'avisoSiniestroCompania',
    limite: { valor: 3, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Responsable Express',
    entregable: 'Solicitud inicial de documentos registrada',
    alcance: 'ajustador',
  },
  {
    id: 'acuseReciboDocs',
    fase: 2,
    nombre: 'Acuse de recibo de documentación',
    actividad: 'Emitir el acuse de recibo desde el último documento recibido',
    campoFecha: 'fechaAcuseReciboDocumentos',
    campoDoc: null,
    referencia: 'fechaUltimoDocumento',
    limite: { valor: 3, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Responsable Express',
    entregable: 'Acuse de recibo emitido',
    alcance: 'ajustador',
  },
  {
    id: 'definicionCaso',
    fase: 3,
    nombre: 'Definición del caso o documentación adicional',
    actividad:
      'Emitir la definición del caso o solicitar documentación adicional (desde el último documento)',
    campoFecha: 'fechaDefinicionCaso',
    campoDoc: null,
    referencia: 'fechaUltimoDocumento',
    limite: { valor: 5, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Responsable Express',
    entregable: 'Definición del caso o solicitud de documentación adicional',
    alcance: 'ajustador',
    criterioCompletitud: 'definicionODocsAdicionalesExpress',
  },
  {
    id: 'docsPendientes',
    fase: 4,
    nombre: 'Documentos pendientes',
    actividad: 'Recibir el último documento tras la solicitud de documentos pendientes',
    campoFecha: 'fechaUltimoDocumento',
    campoDoc: null,
    referencia: 'fechaSolicitudDocumentosPendientes',
    limite: { valor: 1, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Responsable Express',
    entregable: 'Último documento recibido tras solicitud de pendientes',
    alcance: 'ajustador',
  },
  {
    id: 'presentacionCifras',
    fase: 5,
    nombre: 'Presentación de cifras',
    actividad: 'Presentar las cifras correspondientes',
    campoFecha: 'fechaPresentacionCifras',
    campoDoc: null,
    referencia: 'fechaDefinicionCaso',
    referenciaAlternativa: 'fechaRespuestaAnalista',
    limite: { valor: 1, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Responsable Express',
    entregable: 'Presentación de cifras registrada',
    alcance: 'ajustador',
  },
  {
    id: 'reconsideracion',
    fase: 5.5,
    nombre: 'Reconsideración',
    actividad: 'Registrar reconsideración cuando aplique (omitir si no aplica)',
    campoFecha: 'fechaReconsideracion',
    campoDoc: null,
    referencia: 'fechaPresentacionCifras',
    limite: { valor: 1, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Responsable Express',
    entregable: 'Reconsideración registrada o marcada como no aplica',
    alcance: 'ajustador',
  },
  {
    id: 'documentosPago',
    fase: 6,
    nombre: 'Cargue de documentos de pago',
    actividad: 'Cargar los documentos para pago',
    campoFecha: 'fechaDocumentosPago',
    campoDoc: null,
    referencia: 'fechaReconsideracion',
    referenciaAlternativa: 'fechaPresentacionCifras',
    limite: { valor: 1, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Responsable Express',
    entregable: 'Documentos para pago cargados',
    alcance: 'ajustador',
  },
  {
    id: 'finiquitosFirmados',
    fase: 7,
    nombre: 'Finiquitos firmados',
    actividad: 'Registrar la fecha de finiquitos firmados',
    campoFecha: 'fechaFiniquitosFirmado',
    campoDoc: null,
    referencia: 'fechaDocumentosPago',
    referenciaAlternativa: 'fechaPresentacionCifras',
    limite: { valor: 1, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Responsable Express',
    entregable: 'Finiquitos firmados registrados',
    alcance: 'ajustador',
  },
];

export function obtenerProtocoloExpressPorDefecto() {
  return {
    clave: 'express',
    version: PROTOCOLO_EXPRESS_VERSION,
    documento: PROTOCOLO_EXPRESS_DOCUMENTO,
    fechaActivacion: PROTOCOLO_EXPRESS_FECHA_ACTIVACION,
    etapas: ETAPAS_PROTOCOLO_EXPRESS_DEFAULT.map((e) => ({
      ...e,
      limite: e.limite ? { ...e.limite } : null,
      limiteMaximo: e.limiteMaximo ? { ...e.limiteMaximo } : null,
    })),
    seguimientosRecurrentes: [],
    esperasExternas: [],
    graciaEsperaExternaDiasHabiles: 0,
  };
}
