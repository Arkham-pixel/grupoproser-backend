import mongoose from 'mongoose';

const ResponsableSchema = new mongoose.Schema({
  codiRespnsble: String,
  nmbrRespnsble: String,
  email: String,
  telefono: String
}, { collection: 'gsk3cAppresponsable' });

const Responsable = mongoose.model('Responsable', ResponsableSchema);
export default Responsable; 