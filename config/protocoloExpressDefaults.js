/**
 * ANS / protocolo de tiempos — siniestros Express.
 * Plazos en días hábiles Colombia (festivos + fines de semana).
 */

export const PROTOCOLO_EXPRESS_VERSION = '2026-07-24-ans';
export const PROTOCOLO_EXPRESS_FECHA_ACTIVACION = '2026-07-24';
export const PROTOCOLO_EXPRESS_DOCUMENTO =
  'ANS Express — solicitud de configuración de alertas (julio 2026)';

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
    actividad: 'Emitir el acuse de recibo de la documentación aportada',
    campoFecha: 'fechaAcuseReciboDocumentos',
    campoDoc: null,
    referencia: 'fechaReciboDocumentos',
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
    referenciaAlternativa: 'fechaReciboDocumentos',
    limite: { valor: 5, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Responsable Express',
    entregable: 'Definición del caso o solicitud de documentación adicional',
    alcance: 'ajustador',
    criterioCompletitud: 'definicionODocsAdicionalesExpress',
  },
  {
    id: 'correcciones',
    fase: 4,
    nombre: 'Correcciones requeridas',
    actividad: 'Presentar las correcciones requeridas',
    campoFecha: 'fechaCorreccionesPresentadas',
    campoDoc: null,
    referencia: 'fechaSolicitudCorrecciones',
    limite: { valor: 1, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Responsable Express',
    entregable: 'Correcciones presentadas',
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
    id: 'documentosPago',
    fase: 6,
    nombre: 'Documentos para pago',
    actividad: 'Montar los documentos para pago',
    campoFecha: 'fechaDocumentosPago',
    campoDoc: null,
    referencia: 'fechaPresentacionCifras',
    limite: { valor: 1, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Responsable Express',
    entregable: 'Documentos para pago montados',
    alcance: 'ajustador',
    criterioCompletitud: 'documentosPagoExpress',
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
