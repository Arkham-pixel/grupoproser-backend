import mongoose from 'mongoose';

const ResponsableSchema = new mongoose.Schema({
  codiRespnsble: String,
  nmbrRespnsble: String,
  email: String,
  telefono: String,
  /** Último correo automático de alertas Complex (recordatorio cada 30 días). */
  fchaUltimoRecordatorioAlertas: Date,
}, { collection: 'gsk3cAppresponsable' });

const Responsable = mongoose.model('Responsable', ResponsableSchema);
export default Responsable; 