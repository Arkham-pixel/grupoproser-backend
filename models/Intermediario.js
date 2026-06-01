import mongoose from 'mongoose';

const IntermediarioSchema = new mongoose.Schema({
  codigo: { type: String, unique: true, required: true },
  nombre: { type: String, required: true },
  correo: String,
  telefono: String,
  direccion: String,
  ciudad: String,
  estado: { type: Number, default: 1 }, // 1 = activo, 0 = inactivo
}, { collection: 'intermediarios' });

export default mongoose.model('Intermediario', IntermediarioSchema);

