import mongoose from 'mongoose';

const AnexoSchema = new mongoose.Schema({
  nombre: String,
  url: String,
  tamano: Number,
  tipo: String,
  fechaSubida: { type: Date, default: Date.now },
}, { _id: false });

const SiniestroExpressSchema = new mongoose.Schema({
  consecutivo: String,
  responsable: String,
  codigoWorkflow: String,
  numeroSiniestro: { type: String, required: true },
  /** Fecha del siniestro (columna Excel FECHA DE SINIESTRO) */
  fechaSiniestro: Date,
  avisoSiniestro: Date,
  avisoSiniestroCompania: Date,
  fechaReciboDocumentos: Date,
  fechaCargueFiniquito: Date,
  amparo: { type: String, required: true },
  valorIndemnizacion: Number,
  /** Estado del liquidador Express (conceptos, deducible, checklist, salvamento) */
  liquidador: { type: mongoose.Schema.Types.Mixed, default: null },
  observacionesSeguimiento: String,
  anexos: [AnexoSchema],
  aseguradora: { type: String, required: true },
  intermediario: String,
  ciudadSiniestro: { type: String, required: true },
  aseguradoBeneficiario: { type: String, required: true },
  nit: String,
  analista: String,
  fechaEnvioAutorizacion: Date,
  fechaRespuestaAnalista: Date,
  correoNotificacion: String,
  fechaCierre: Date,
  fechaSolicitudDocumentos: Date,
  /** ANS Express: acuse de recibo de la documentación aportada */
  fechaAcuseReciboDocumentos: Date,
  /** ANS Express: recepción del último documento (inicio plazo definición) */
  fechaUltimoDocumento: Date,
  /** ANS Express: definición del caso */
  fechaDefinicionCaso: Date,
  /** ANS Express: alternativa a definición — solicitud de docs adicionales */
  fechaSolicitudDocumentosAdicionales: Date,
  /** Solicitud de documentos pendientes (fecha oficial Express) */
  fechaSolicitudDocumentosPendientes: Date,
  /** ANS Express: cuando se requirieron correcciones */
  fechaSolicitudCorrecciones: Date,
  /** ANS Express: cuando se presentaron las correcciones */
  fechaCorreccionesPresentadas: Date,
  fechaPresentacionCifras: Date,
  /** Reconsideración (fecha oficial Express) */
  fechaReconsideracion: Date,
  /** 'aplica' | 'no_aplica' — si no aplica, no cuenta en ANS ni genera alerta */
  reconsideracionAplica: String,
  /** ANS Express: montaje de documentos para pago */
  fechaDocumentosPago: Date,
  fechaFiniquitosFirmado: Date,
  /**
   * Último recordatorio enviado al asegurado por docs pendientes.
   * Ciclo: 30 días desde fechaSolicitudDocumentos (o desde esta fecha si ya existe).
   */
  fechaRecordatorio: Date,
  reserva: Number,
  estadoProceso: { type: String, required: true },
  /** 'aplica' | 'no_aplica' */
  salvamentoAplica: String,
  valorSalvamento: Number,
  anexosSalvamento: [AnexoSchema],
}, {
  collection: 'gsk3cAppsiniestroExpress',
  timestamps: true,
});

const SiniestroExpress = mongoose.model('SiniestroExpress', SiniestroExpressSchema, 'gsk3cAppsiniestroExpress');

export default SiniestroExpress;


