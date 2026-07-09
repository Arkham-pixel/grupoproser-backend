import mongoose from 'mongoose';

const ProtocoloSiniestrosConfigSchema = new mongoose.Schema(
  {
    clave: { type: String, default: 'complex', unique: true },
    version: String,
    fechaActivacion: String,
    etapas: [mongoose.Schema.Types.Mixed],
    seguimientosRecurrentes: [mongoose.Schema.Types.Mixed],
    actualizadoPor: String,
    actualizadoEn: Date,
  },
  {
    collection: 'protocolo_siniestros_config',
    strict: false,
  }
);

export default mongoose.model('ProtocoloSiniestrosConfig', ProtocoloSiniestrosConfigSchema);
