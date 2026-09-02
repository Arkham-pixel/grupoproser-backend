import mongoose from 'mongoose';

const CasoResumenSchema = new mongoose.Schema(
  {
    id: { type: String, default: '' },
    etiqueta: { type: String, default: '' },
    consecutivo: { type: String, default: '' },
    siniestro: { type: String, default: '' },
    asegurado: { type: String, default: '' },
    fecha: { type: String, default: '' },
    horaInicio: { type: String, default: '' },
    horaFin: { type: String, default: '' },
  },
  { _id: false }
);

const NotificacionOperativaSchema = new mongoose.Schema(
  {
    recipientUserId: { type: String, required: true, index: true },
    recipientLogin: { type: String, default: '', index: true },
    recipientRole: { type: String, default: '' },
    tipo: {
      type: String,
      enum: ['asignacion', 'desasignacion', 'caso_nuevo', 'visita'],
      required: true,
    },
    modulo: { type: String, required: true },
    titulo: { type: String, required: true },
    mensaje: { type: String, default: '' },
    cantidad: { type: Number, default: 1 },
    ruta: { type: String, default: '' },
    campoAsignacion: { type: String, default: '' },
    claveDedupe: { type: String },
    casos: { type: [CasoResumenSchema], default: [] },
    leida: { type: Boolean, default: false, index: true },
    leidaEn: { type: Date, default: null },
  },
  {
    collection: 'gsk3cAppnotificacionesOperativas',
    timestamps: true,
  }
);

NotificacionOperativaSchema.index({ recipientUserId: 1, leida: 1, createdAt: -1 });
NotificacionOperativaSchema.index({ recipientLogin: 1, leida: 1, createdAt: -1 });
NotificacionOperativaSchema.index({ claveDedupe: 1 }, { unique: true, sparse: true });
NotificacionOperativaSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 120 });

const NotificacionOperativa = mongoose.model(
  'NotificacionOperativa',
  NotificacionOperativaSchema,
  'gsk3cAppnotificacionesOperativas'
);

export default NotificacionOperativa;
