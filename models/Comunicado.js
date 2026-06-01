import mongoose from 'mongoose';

const ComunicadoSchema = new mongoose.Schema({
  titulo: { type: String, required: true },
  mensaje: { type: String, required: true },
  fecha: { type: Date, required: true },
  fechaFin: { type: Date, required: true },
  duracion: { type: Number, required: true }
}, { timestamps: true });

export default mongoose.model('Comunicado', ComunicadoSchema); 