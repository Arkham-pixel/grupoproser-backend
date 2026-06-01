import mongoose from 'mongoose';

const estadoRiesgoSchema = new mongoose.Schema({
  codiEstdo: Number,
  descEstdo: String
}, { collection: 'gsk3cAppestadosRiesgos' });

const EstadoRiesgo = mongoose.model('EstadoRiesgo', estadoRiesgoSchema);
export default EstadoRiesgo; 