import mongoose from 'mongoose';

const TareaSchema = new mongoose.Schema({
  login: { type: String, required: true },
  texto: { type: String, required: true },
  fecha: { type: Date, required: true },
  cumplida: { type: Boolean, default: false },
  prioridad: { 
    type: String, 
    enum: ['ALTA', 'MEDIA', 'BAJA'], 
    default: 'MEDIA' 
  },
  emailResponsable: { type: String },
  fechaCumplimiento: { type: Date },
  observaciones: { type: String },
  // Campos para sistema de alertas automáticas
  ultimaAlertaEnviada: { type: Date }, // Última vez que se envió alerta
  alertaFinalEnviada: { type: Boolean, default: false }, // Si ya se envió alerta final
  diasRestantes: { type: Number }, // Días restantes para completar
  activarAlertas: { type: Boolean, default: true } // Si las alertas están activas
}, { timestamps: true });

export default mongoose.model('Tarea', TareaSchema); 