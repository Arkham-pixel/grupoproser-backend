// models/Complex.js
import mongoose from 'mongoose';

const ComplexSchema = new mongoose.Schema({
  // Campos principales según la base de datos real
  nmroAjste: { type: String, unique: true },
  codWorkflow: String,
  nmroSinstro: String,
  nombIntermediario: String,
  codiAsgrdra: String,
  funcAsgrdra: String,
  codiRespnsble: String,
  asgrBenfcro: String,
  tipoDucumento: String,
  numDocumento: String,
  tipoPoliza: String,
  nmroPolza: String,
  amprAfctdo: String,
  fchaSinstro: Date,
  descSinstro: String,
  causa_siniestro: String,
  ciudadSiniestro: String,
  descripcionCiudad: String, // Nombre completo: Municipio, Departamento, País
  nombreCiudad: String, // Solo nombre del municipio
  departamentoCiudad: String, // Nombre del departamento
  fchaInspccion: Date,
  /** true = inspección no procede; no genera alertas de inspección ni de acta */
  inspeccionNoAplica: { type: Boolean, default: false },
  /** true = hubo inspección pero no se elabora acta */
  actaInspeccionNoAplica: { type: Boolean, default: false },
  codiEstdo: String,
  descripcionEstado: String,
  observacionesPendientes: String,
  fchaContIni: Date,
  obseContIni: String,
  anexContIni: String,
  fchaCoordInspeccion: Date,
  fchaProgInspeccion: Date,
  obseCoordInspeccion: String,
  obseInspccion: String,
  fchaSoliDocu: Date,
  anexActaInspccion: String,
  anexSolDoc: String,
  obseSoliDocu: String,
  fchaInfoPrelm: Date,
  obseInfoPrelm: String,
  anxoInfPrelim: String,
  fchaInfoFnal: Date,
  obseInfoFnal: String,
  anxoInfoFnal: String,
  fchaRepoActi: Date,
  obseRepoActi: String,
  anxoRepoActi: String,
  fchaPresentacionCifras: Date,
  fchaAceptacionCifrasAseguradora: Date,
  fchaUltSegui: Date,
  fchaActSegui: Date,
  diasTranscrrdo: Number,
  obseSegmnto: String,
  vlorResrva: Number,
  vlorReclmo: Number,
  montoIndmzar: Number,
  fchaFinqtoIndem: Date,
  nmroFactra: String,
  vlorServcios: Number,
  vlorGastos: Number,
  total: Number,
  iva: Number,
  reteiva: Number,
  retefuente: Number,
  reteica: Number,
  totalGeneral: Number,
  totalPagado: Number,
  fchaFactra: Date,
  anxoFactra: String,
  anxoHonorarios: String,
  anxoHonorariosdefinit: String,
  anxoAutorizacion: String,
  fchaUltRevi: Date,
  fcha_control_horas: Date, // Fecha de control de horas
  fcha_envio_control_horas: Date, // Fecha de envío control de horas (Gerencia)
  fcha_recibido_control_horas: Date, // Fecha de recibido control de horas (Gerencia)
  control_horas: {
    valor_hora: Number,
    valor_hora_origen: String,
    gastos: Number,
    filas: [
      {
        id: String,
        fecha: Date,
        descripcion: String,
        nombre_funcionario: String,
        cargo: String,
        horas_viaje: Number,
        horas_campo: Number,
        horas_oficina: Number,
        horas_secretaria: Number,
      },
    ],
    actualizado_en: Date,
    actualizado_por: String,
  },
  anxoEvidencia: String, // Adjunto de evidencia (Gerencia)
  fcha_seguimiento_envio_control_horas: Date, // Fecha de seguimiento de envío control de horas
  obse_seguimiento_envio_control_horas: String, // Observaciones/comentarios de seguimiento de envío control de horas
  anxo_seguimiento_envio_control_horas: String, // Adjunto de documentos de seguimiento de envío control de horas
  obseComprmsi: String,
  observacionesValores: String,
  porcIva: Number,
  porcReteiva: Number,
  porcRetefuente: Number,
  porcReteica: Number,
  fchaAsgncion: Date,
  plantillaContactoInicial: {
    tipoDestinatario: String,
    ramoManual: String,
    opcionesInspeccion: [
      {
        fecha: String,
        hora: String,
      },
    ],
    documentosSeleccionados: [String],
    textoGenerado: String,
    actualizadoEn: String,
  },
  envios_facturacion: [mongoose.Schema.Types.Mixed],
  ultimo_envio_facturacion: mongoose.Schema.Types.Mixed,
  historialDocs: [
    {
      tipo: String,
      nombre: String,
      fecha: String,
      comentario: String,
      url: String,
      ruta: String,
      tamano: Number,
      tipoMime: String,
      fechaSubida: String, // Cambiado a String para evitar problemas de zona horaria
      usuario: String,
      data: String,
      error: String
    }
  ],
}, { 
  collection: 'gsk3cAppsiniestro',
  strict: false, // Permitir campos adicionales no definidos en el schema
  // Usar la conexión principal de MongoDB
  connection: mongoose.connection
});

ComplexSchema.index({ 'envios_facturacion.gerente': 1 }, { sparse: true });
ComplexSchema.index({ 'ultimo_envio_facturacion.gerente': 1 }, { sparse: true });

export default mongoose.model('Complex', ComplexSchema);
