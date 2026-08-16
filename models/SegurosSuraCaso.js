import mongoose from 'mongoose';

const ArchivoSuraSchema = new mongoose.Schema(
  {
    nombreOriginal: { type: String, required: true },
    nombreArchivo: String,
    ruta: { type: String, required: true },
    tamaño: Number,
    tipoMime: String,
    /** Póliza, inspección, liquidación, fotos, otro… */
    etiqueta: { type: String, default: 'GENERAL' },
    /** Leyenda / descripción para el informe Word (fotos de inspección). */
    descripcion: { type: String, default: '' },
    subidoPor: {
      id: String,
      login: String,
      nombre: String,
    },
    fechaSubida: { type: Date, default: Date.now },
  },
  { _id: true }
);

const ControlHorasFilaSchema = new mongoose.Schema(
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
  { _id: false }
);

/**
 * Casos Seguros SURA.
 * Conserva identidad CAT (reporte/bloques/liquidador) y acepta el payload tipo Complex
 * (agregar datos + control de horas), sin trazabilidad.
 */
const SegurosSuraCasoSchema = new mongoose.Schema(
  {
    /** Formato SURA-YYYY-MM-N (asignado al crear; no editable) */
    consecutivo: String,
    siniestro: String,
    identificacion: { type: String, required: true },
    asegurado: String,
    tomador: String,
    ajustador: String,
    numeroPoliza: String,
    direccionPredio: String,
    numeroCredito: String,
    informacionContacto: String,
    correo: String,
    /** Celular del asegurado o de quien lo asiste (cierre del siniestro) */
    celular: String,
    canalRadicacion: String,
    ciudad: String,
    departamento: String,
    fechaSiniestro: Date,
    fechaInicioPoliza: Date,
    fechaFinPoliza: Date,
    valorAseguradoInmueble: Number,
    valorAseguradoContenidos: Number,
    cobertura: String,
    estadoPagoPrimas: String,
    valorReservaPreventivaPromedio: Number,
    valorComercialInmueble: Number,
    reserva: Number,
    valorReclamado: Number,
    valorLiquidado: Number,
    fechaLlamada: Date,
    observacionLlamada: { type: String, default: '' },
    fechaInspeccion: Date,
    fechaUltimoDocumento: Date,
    fechaLiquidado: Date,
    fechaAceptacionLiquidacion: Date,
    fechaEnvioAseguradora: Date,
    estado: { type: String, required: true },
    ubicacionPredio: {
      lat: Number,
      lng: Number,
      geocodedAt: Date,
      geocodeStatus: {
        type: String,
        enum: ['ok', 'failed', 'pending', 'stale', 'manual', 'sin_direccion'],
      },
      geocodeQuery: String,
      direccionHash: String,
      locationType: String,
      formattedAddress: String,
    },
    liquidador: { type: mongoose.Schema.Types.Mixed, default: null },
    informeUnico: { type: mongoose.Schema.Types.Mixed, default: null },
    informeAgil: { type: mongoose.Schema.Types.Mixed, default: null },
    salvamento: { type: mongoose.Schema.Types.Mixed, default: null },
    archivos: { type: [ArchivoSuraSchema], default: [] },

    /** Campos tipo Complex (formulario agregar datos) */
    nmroAjste: String,
    codWorkflow: String,
    nmroSinstro: String,
    nombIntermediario: String,
    codiAsgrdra: String,
    nombreCliente: String,
    nombreAseguradora: String,
    funcAsgrdra: String,
    funcAsgrdraNombre: String,
    emailFuncionarioAseguradora: String,
    codiRespnsble: String,
    nombreResponsable: String,
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
    descripcionCiudad: String,
    nombreCiudad: String,
    departamentoCiudad: String,
    fchaInspccion: Date,
    inspeccionNoAplica: { type: Boolean, default: false },
    actaInspeccionNoAplica: { type: Boolean, default: false },
    codiEstdo: String,
    descripcionEstado: String,
    observacionesPendientes: String,
    fchaAsgncion: Date,
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
    fcha_control_horas: Date,
    fcha_envio_control_horas: Date,
    fcha_recibido_control_horas: Date,
    control_horas: {
      valor_hora: Number,
      valor_hora_origen: String,
      gastos: Number,
      filas: [ControlHorasFilaSchema],
      actualizado_en: Date,
      actualizado_por: String,
    },
    anxoEvidencia: String,
    fcha_seguimiento_envio_control_horas: Date,
    obse_seguimiento_envio_control_horas: String,
    anxo_seguimiento_envio_control_horas: String,
    obseComprmsi: String,
    observacionesValores: String,
    porcIva: Number,
    porcReteiva: Number,
    porcRetefuente: Number,
    porcReteica: Number,
    fchaUltSegui: Date,
    fchaActSegui: Date,
    diasTranscrrdo: Number,
    obseSegmnto: String,
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
        fechaSubida: String,
        usuario: String,
        data: String,
        error: String,
      },
    ],
  },
  {
    collection: 'gsk3cAppsegurosSuraCasos',
    timestamps: true,
    strict: false,
  }
);

SegurosSuraCasoSchema.index({ 'envios_facturacion.gerente': 1 }, { sparse: true });
SegurosSuraCasoSchema.index({ nmroAjste: 1 }, { sparse: true });
SegurosSuraCasoSchema.index({ nmroSinstro: 1 }, { sparse: true });

const SegurosSuraCaso = mongoose.model(
  'SegurosSuraCaso',
  SegurosSuraCasoSchema,
  'gsk3cAppsegurosSuraCasos'
);

export default SegurosSuraCaso;
