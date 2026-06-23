import mongoose from 'mongoose';

const HistorialDocSchema = new mongoose.Schema(
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
  },
  { _id: false }
);

const PuertosCasoSchema = new mongoose.Schema(
  {
    tipoRegistro: { type: String, default: 'caso_exportacion' },
    consecutivo: { type: String, unique: true, sparse: true },
    numeroSolicitud: String,
    numeroActa: String,

    creadoPor: String,
    emailCreador: String,
    fechaInforme: Date,
    departamentoInforme: String,

    // Datos generales (patrón Complex)
    codiRespnsble: String,
    nombreResponsable: String,
    codiAsgrdra: String,
    nombreAseguradora: String,
    funcAsgrdra: String,
    funcAsgrdraNombre: String,
    asgrBenfcro: String,
    tipoDucumento: String,
    numDocumento: String,
    nombIntermediario: String,
    codiEstdo: String,
    descripcionEstado: String,
    observacionesPendientes: String,

    actividad: String,
    ciudadRiesgo: String,
    laborRealizada: String,
    lugar: String,

    // Trazabilidad
    fchaAsgncion: Date,
    fchaContIni: Date,
    fchaCoordInspeccion: Date,
    fchaProgInspeccion: Date,
    fchaInspccion: Date,
    fchaInfoFnal: Date,
    fchaFactra: Date,
    obseContIni: String,
    obseCoordInspeccion: String,
    obseInspccion: String,
    obseInfoFnal: String,
    obseSegmnto: String,

    historialDocs: { type: [HistorialDocSchema], default: [] },

    // Cuerpo del informe exportación (Precocidos y similares)
    informeExportacion: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Facturación
    vlorServcios: Number,
    vlorGastos: Number,
    total: Number,
    nmroFactra: String,

    creadoPor: String,
    actualizadoPor: String,
  },
  {
    collection: 'puertos_casos',
    timestamps: true,
    strict: false,
  }
);

PuertosCasoSchema.index({ codiAsgrdra: 1, fchaInspccion: -1 });
PuertosCasoSchema.index({ asgrBenfcro: 1 });

export default mongoose.models.PuertosCaso || mongoose.model('PuertosCaso', PuertosCasoSchema);
