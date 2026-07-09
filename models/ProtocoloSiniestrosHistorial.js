import mongoose from 'mongoose';

const ProtocoloSiniestrosHistorialSchema = new mongoose.Schema(
  {
    clave: { type: String, default: 'complex' },
    version: String,
    accion: { type: String, enum: ['actualizacion', 'restauracion'], default: 'actualizacion' },
    usuario: String,
    snapshot: mongoose.Schema.Types.Mixed,
    cambiosResumen: String,
  },
  {
    collection: 'protocolo_siniestros_historial',
    timestamps: true,
  }
);

export default mongoose.model('ProtocoloSiniestrosHistorial', ProtocoloSiniestrosHistorialSchema);
