import mongoose from 'mongoose';

const ClasificacionRiesgoSchema = new mongoose.Schema({
  codIdentificador: Number,
  rzonDescripcion: String
}, { collection: 'gsk3cClasriesgopoliza' });

const ClasificacionRiesgo = mongoose.model('ClasificacionRiesgo', ClasificacionRiesgoSchema);
export default ClasificacionRiesgo; 