import mongoose from 'mongoose';

const EstadoSchema = new mongoose.Schema({
  codiEstdo: Number,
  descEstdo: String,
  // Variantes legacy en documentos importados
  codiEstado: Number,
  descEstado: String,
}, { collection: 'gsk3cAppestados', strict: false });

const Estado = mongoose.model('Estado', EstadoSchema);
export default Estado; 