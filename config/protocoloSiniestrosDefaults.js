/**
 * Protocolo de atención de siniestros COMPLEX — valores por defecto.
 * Fuente oficial: PROTOCOLO ATENCIÓN DE SINIESTROS - ÚLTIMA VERSIÓN (26 jun 2026).
 * Los tiempos pueden sobrescribirse vía API / MongoDB (ProtocoloSiniestrosConfig).
 */

export const PROTOCOLO_VERSION = '2026-06-26-ultima';
export const PROTOCOLO_FECHA_ACTIVACION = '2025-10-01';
export const PROTOCOLO_DOCUMENTO =
  'PROTOCOLO ATENCIÓN DE SINIESTROS - ÚLTIMA VERSIÓN (26 jun 2026)';

/** @typedef {'horas'|'dias'|'dias_habiles'|'mismo_dia'} UnidadTiempoProtocolo */

/**
 * @typedef {Object} LimiteTiempo
 * @property {number} valor
 * @property {UnidadTiempoProtocolo} unidad
 */

/**
 * @typedef {Object} EtapaProtocolo
 * @property {string} id
 * @property {number} fase
 * @property {string} nombre
 * @property {string} [actividad]
 * @property {string|null} campoFecha
 * @property {string|null} campoDoc
 * @property {string} referencia
 * @property {LimiteTiempo} limite
 * @property {LimiteTiempo|null} [limiteMaximo]
 * @property {boolean} [alertaVencimiento]
 * @property {string} [responsable]
 * @property {string} [entregable]
 * @property {'ajustador'|'soporte'|'todos'} [alcance]
 * @property {string} [criterioCompletitud]
 */

/**
 * @typedef {Object} SeguimientoRecurrente
 * @property {string} id
 * @property {number} [fase]
 * @property {string} nombre
 * @property {number} intervaloDias
 * @property {string} referencia
 * @property {string|null} campoFechaHasta
 * @property {string} [descripcion]
 */

export const GRACIA_ESPERA_EXTERNA_DIAS_HABILES = 10;

/**
 * Alertas por esperas de terceros (asegurado, compañía, intermediario).
 * No se notifica antes de 10 días hábiles desde la fecha de referencia.
 */
export const ALERTAS_ESPERA_EXTERNA_DEFAULT = [
  {
    id: 'coordinacionInspeccion',
    fase: 4,
    nombre: 'Coordinación de inspección',
    referencia: 'fchaContIni',
    requiereCampo: 'fchaContIni',
    camposCompletitud: ['fchaProgInspeccion', 'fchaInspccion'],
    mensaje:
      'Sin fecha programada de inspección: han pasado 10 días hábiles desde el contacto inicial',
    accion: 'Coordinar con el asegurado/intermediario y registrar la fecha programada de inspección',
  },
];

/** @type {EtapaProtocolo[]} */
export const ETAPAS_PROTOCOLO_DEFAULT = [
  {
    id: 'activacionRecepcion',
    fase: 1,
    nombre: 'Recepción de asignación',
    actividad: 'Recepción de asignación del siniestro',
    campoFecha: 'fchaAsgncion',
    campoDoc: null,
    referencia: 'fchaAsgncion',
    limite: { valor: 0, unidad: 'dias' },
    alertaVencimiento: false,
    responsable: 'Coordinación / área de asignaciones - BACK',
    entregable: 'Asignación recibida y registrada (día 0)',
    alcance: 'ajustador',
    notificacionAsignacion: 'email_al_asignar',
  },
  {
    id: 'carguePlataforma',
    fase: 2,
    nombre: 'Cargue a plataforma y asignación interna',
    actividad: 'Cargue a plataforma y asignación interna del caso',
    campoFecha: null,
    campoDoc: null,
    referencia: 'fchaAsgncion',
    limite: { valor: 12, unidad: 'horas' },
    alertaVencimiento: true,
    responsable: 'Coordinación / soporte ARNALD - BACK',
    entregable: 'Caso creado/actualizado en ARNALD y ajustador asignado',
    alcance: 'soporte',
    criterioCompletitud: 'codiRespnsble',
  },
  {
    id: 'contactoInicial',
    fase: 3,
    nombre: 'Contacto inicial',
    actividad:
      'Contacto con intermediario (llamada y correo), fechas de inspección y documentos básicos',
    campoFecha: 'fchaContIni',
    campoDoc: 'anexContIni',
    referencia: 'fchaAsgncion',
    limite: { valor: 12, unidad: 'horas' },
    alertaVencimiento: true,
    responsable: 'Ajustador asignado',
    entregable: 'Correo, llamada y solicitud básica de documentos',
    alcance: 'ajustador',
  },
  {
    id: 'inspeccion',
    fase: 4,
    nombre: 'Inspección de campo',
    actividad: 'Realización de inspección del riesgo / lugar de ocurrencia',
    campoFecha: 'fchaInspccion',
    // Completa con la fecha; el acta es etapa aparte (puede no elaborarse).
    campoDoc: null,
    // Con fecha programada (coordinación): el plazo corre desde esa cita.
    // Sin ella: desde el contacto inicial.
    referencia: 'fchaProgInspeccion',
    referenciaAlternativa: 'fchaContIni',
    // Días hábiles Colombia (no sábado, domingo ni festivos).
    // Ej.: visita/programada viernes → tienen hasta el lunes hábil siguiente.
    limite: { valor: 1, unidad: 'dias_habiles' },
    limiteMaximo: { valor: 3, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Ajustador asignado / inspector',
    entregable: 'Inspección realizada, registro fotográfico y observaciones',
    alcance: 'ajustador',
  },
  {
    id: 'actaInspeccion',
    fase: 5,
    nombre: 'Cargue del acta de inspección',
    actividad: 'Cargue del acta de inspección (si aplica)',
    campoFecha: 'fchaInspccion',
    campoDoc: 'anexActaInspccion',
    referencia: 'fchaInspccion',
    // Tras la visita: 1 día hábil para subir el acta/documento (vie → lun).
    limite: { valor: 1, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Ajustador asignado',
    entregable:
      'Acta de inspección cargada en ARNALD (1 día hábil tras la inspección) o registro de no aplica',
    alcance: 'ajustador',
  },
  {
    id: 'solicitudDocs',
    fase: 6,
    nombre: 'Solicitud de documentos adicionales',
    actividad: 'Solicitud de documentos adicionales derivados de la inspección',
    campoFecha: 'fchaSoliDocu',
    campoDoc: 'anexSolDoc',
    referencia: 'fchaInspccion',
    limite: { valor: 12, unidad: 'horas' },
    alertaVencimiento: true,
    responsable: 'Ajustador asignado',
    entregable: 'Correo con requerimiento y soporte en ARNALD',
    alcance: 'ajustador',
  },
  {
    id: 'informePreliminar',
    fase: 7,
    nombre: 'Informe preliminar',
    actividad: 'Emisión del informe preliminar',
    campoFecha: 'fchaInfoPrelm',
    campoDoc: 'anxoInfPrelim',
    referencia: 'fchaSoliDocu',
    referenciaAlternativa: 'fchaInspccion',
    limite: { valor: 3, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Ajustador asignado / revisor técnico',
    entregable: 'Informe preliminar cargado y enviado',
    alcance: 'ajustador',
  },
  {
    id: 'acreditacion',
    fase: 9,
    nombre: 'Acreditación del siniestro',
    actividad: 'Acreditación del siniestro (fecha del último documento requerido)',
    campoFecha: 'fchaRepoActi',
    campoDoc: null,
    referencia: 'fchaSoliDocu',
    limite: null,
    alertaVencimiento: false,
    responsable: 'Ajustador asignado / revisor técnico',
    entregable: 'Expediente documental completo para análisis final',
    alcance: 'ajustador',
  },
  {
    id: 'informeFinal',
    fase: 10,
    nombre: 'Informe final y liquidación',
    actividad: 'Envío de informe final y liquidación',
    campoFecha: 'fchaInfoFnal',
    campoDoc: 'anxoInfoFnal',
    referencia: 'fchaRepoActi',
    limite: { valor: 3, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    responsable: 'Ajustador asignado / revisor técnico',
    entregable: 'Informe final, liquidación y anexos enviados a la compañía',
    alcance: 'ajustador',
  },
  {
    id: 'autorizacionCifras',
    fase: 11,
    nombre: 'Autorización de cifras por la compañía',
    actividad: 'Autorización de cifras por parte de la compañía',
    campoFecha: 'fchaAceptacionCifrasAseguradora',
    campoDoc: 'anxoAutorizacion',
    referencia: 'fchaInfoFnal',
    limite: { valor: 3, unidad: 'dias_habiles' },
    alertaVencimiento: false,
    dependenciaExterna: true,
    responsable: 'Compañía / analista de siniestros',
    entregable: 'Aprobación, observaciones o solicitud de ajuste de cifras',
    alcance: 'ajustador',
  },
  {
    id: 'presentacionCifras',
    fase: 12,
    nombre: 'Presentación de cifras y finiquitos',
    actividad: 'Envío de presentación de cifras y finiquitos',
    campoFecha: 'fchaPresentacionCifras',
    campoDoc: 'anxoPresentacionCifras',
    referencia: 'fchaAceptacionCifrasAseguradora',
    limite: { valor: 12, unidad: 'horas' },
    alertaVencimiento: true,
    responsable: 'Ajustador asignado',
    entregable: 'Correo de presentación de cifras, finiquitos y documentos de pago',
    alcance: 'ajustador',
    criterioCompletitud: 'presentacionYFiniquito',
  },
  {
    id: 'envioFiniquito',
    fase: 14,
    nombre: 'Envío de finiquito (detalle)',
    actividad: 'Envío de finiquito e indemnización',
    campoFecha: 'fchaEnvioFiniquito',
    campoDoc: 'anxoEnvioFiniquito',
    referencia: 'fchaPresentacionCifras',
    referenciaAlternativa: 'fchaAceptacionCifrasAseguradora',
    limite: { valor: 10, unidad: 'dias_habiles' },
    alertaVencimiento: true,
    dependenciaExterna: true,
    graciaDiasHabiles: GRACIA_ESPERA_EXTERNA_DIAS_HABILES,
    responsable: 'Ajustador asignado / asegurado (documentos de pago)',
    alcance: 'ajustador',
  },
];

/** @type {SeguimientoRecurrente[]} */
export const SEGUIMIENTOS_RECURRENTES_DEFAULT = [
  {
    id: 'seguimientoDocumentos',
    fase: 8,
    nombre: 'Seguimiento de documentos pendientes',
    historialTipo: 'seguimientoDocsPendientes',
    intervaloDias: 15,
    graciaDiasHabiles: GRACIA_ESPERA_EXTERNA_DIAS_HABILES,
    dependenciaExterna: true,
    referencia: 'fchaSoliDocu',
    campoFechaHasta: 'fchaRepoActi',
    actividad: 'Seguimiento de documentos pendientes',
    entregable: 'Correos de seguimiento y actualización del estado documental',
    responsable: 'Ajustador asignado / analista documental',
    descripcion:
      'Primer recordatorio a los 10 días hábiles; luego cada 15 días calendario hasta acreditación.',
  },
  {
    id: 'seguimientoAutorizacion',
    fase: 11,
    nombre: 'Seguimiento autorización de cifras',
    historialTipo: 'seguimientoAutorizacionCompania',
    intervaloDias: 5,
    graciaDiasHabiles: GRACIA_ESPERA_EXTERNA_DIAS_HABILES,
    dependenciaExterna: true,
    referencia: 'fchaInfoFnal',
    campoFechaHasta: 'fchaAceptacionCifrasAseguradora',
    actividad: 'Seguimiento de autorización de cifras por la compañía',
    entregable:
      'Evidencia del correo a la compañía solicitando o reiterando autorización de cifras',
    responsable: 'Ajustador asignado (seguimiento) / Compañía (aprobación)',
    descripcion:
      'Primer recordatorio a los 10 días hábiles; luego cada 5 días calendario hasta aprobación de cifras.',
  },
  {
    id: 'seguimientoPago',
    fase: 13,
    nombre: 'Seguimiento documentos para pago',
    historialTipo: 'seguimientoDocumentosPago',
    intervaloDias: 15,
    graciaDiasHabiles: GRACIA_ESPERA_EXTERNA_DIAS_HABILES,
    dependenciaExterna: true,
    referencia: 'fchaAceptacionCifrasAseguradora',
    campoFechaHasta: 'fchaEnvioFiniquito',
    actividad: 'Seguimiento de documentos para pago',
    entregable:
      'Seguimiento a finiquitos, certificación bancaria, RUT, SARLAFT y demás documentos requeridos',
    responsable: 'Ajustador asignado / analista documental',
    descripcion:
      'Primer recordatorio a los 10 días hábiles; luego cada 15 días calendario hasta completar documentos de pago.',
  },
];

export function obtenerProtocoloPorDefecto() {
  return {
    clave: 'complex',
    version: PROTOCOLO_VERSION,
    documento: PROTOCOLO_DOCUMENTO,
    fechaActivacion: PROTOCOLO_FECHA_ACTIVACION,
    etapas: ETAPAS_PROTOCOLO_DEFAULT.map((e) => ({
      ...e,
      limite: { ...e.limite },
      limiteMaximo: e.limiteMaximo ? { ...e.limiteMaximo } : null,
    })),
    seguimientosRecurrentes: SEGUIMIENTOS_RECURRENTES_DEFAULT.map((s) => ({ ...s })),
    esperasExternas: ALERTAS_ESPERA_EXTERNA_DEFAULT.map((e) => ({ ...e })),
    graciaEsperaExternaDiasHabiles: GRACIA_ESPERA_EXTERNA_DIAS_HABILES,
  };
}
