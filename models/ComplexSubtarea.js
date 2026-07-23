import mongoose from 'mongoose';

const ArchivoSubtareaSchema = new mongoose.Schema(
  {
    nombre: String,
    url: String,
    filename: String,
    /** documento adjunto o formato generado (acta, plantilla, etc.) */
    tipoArchivo: {
      type: String,
      enum: ['documento', 'formato'],
      default: 'documento',
    },
    subidoPor: String,
    subidoPorTipo: {
      type: String,
      enum: ['interno', 'externo', 'creador', 'sistema'],
      default: 'interno',
    },
    fechaSubida: { type: Date, default: Date.now },
  },
  { _id: true }
);

const HistorialEstadoSchema = new mongoose.Schema(
  {
    estado: String,
    fecha: { type: Date, default: Date.now },
    por: String,
    nota: String,
  },
  { _id: false }
);

const ComplexSubtareaSchema = new mongoose.Schema(
  {
    casoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Complex',
      required: true,
      index: true,
    },
    nmroAjste: { type: String, index: true },
    titulo: { type: String, required: true, trim: true },
    /** Clave de bandeja de trazabilidad (contactoInicial, inspeccion, ...) */
    etapaTrazabilidad: { type: String, default: '', index: true },
    /**
     * Flujo visita cuando etapa = coordinacionInspeccion:
     * coordinacion → inspeccion → decidir → (opcional) preliminar.
     */
    flujoVisitaFase: {
      type: String,
      enum: ['', 'coordinacion', 'inspeccion', 'decidir', 'preliminar'],
      default: '',
    },
    /** Id de etapa del protocolo de tiempos */
    etapaProtocoloId: { type: String, default: '' },
    descripcion: { type: String, default: '' },
    instrucciones: { type: String, default: '' },
    tipoAsignado: {
      type: String,
      enum: ['interno', 'externo'],
      required: true,
    },
    codiAsignado: { type: String, default: '', index: true },
    nombreAsignado: { type: String, default: '' },
    emailAsignado: { type: String, default: '' },
    nombreExterno: { type: String, default: '' },
    emailExterno: { type: String, default: '' },
    tokenHash: { type: String, index: true, sparse: true },
    tokenExpira: { type: Date },
    estado: {
      type: String,
      enum: ['pendiente', 'en_progreso', 'completada', 'cancelada'],
      default: 'pendiente',
      index: true,
    },
    fechaLimite: { type: Date },
    /**
     * Fecha del hito de protocolo reportada por el asignado (interno/externo).
     * Compatibilidad: primera fecha de fechasProtocolo.
     */
    fechaProtocolo: { type: Date },
    /**
     * Fechas de la etapa alineadas con trazabilidad
     * (ej. coordinación: fchaCoordInspeccion + fchaProgInspeccion).
     */
    fechasProtocolo: {
      type: Map,
      of: Date,
      default: undefined,
    },
    /** Primera vez que el asignado abre o trabaja la subtarea */
    fechaInicioTrabajo: { type: Date },
    fechaCompletada: { type: Date },
    /** ms desde inicio de trabajo (o creación) hasta completar — control de horas */
    duracionTrabajoMs: { type: Number },
    /** ms desde creación/asignación hasta completar */
    duracionAsignacionMs: { type: Number },
    creadoPorLogin: { type: String, default: '' },
    creadoPorNombre: { type: String, default: '' },
    observacionesAsignado: { type: String, default: '' },
    /** Motivo del gestor al reabrir una subtarea completada (visible para el asignado) */
    motivoReapertura: { type: String, default: '' },
    /** Nombre de quien reabrió la subtarea */
    motivoReaperturaPor: { type: String, default: '' },
    archivos: { type: [ArchivoSubtareaSchema], default: [] },
    historialEstados: { type: [HistorialEstadoSchema], default: [] },
    notificadoEn: { type: Date },
    leidoEnPlataforma: { type: Date },
  },
  {
    collection: 'gsk3cAppsubtareaComplex',
    timestamps: true,
  }
);

ComplexSubtareaSchema.index({ casoId: 1, estado: 1 });
ComplexSubtareaSchema.index({ codiAsignado: 1, estado: 1 });

export default mongoose.model('ComplexSubtarea', ComplexSubtareaSchema);
