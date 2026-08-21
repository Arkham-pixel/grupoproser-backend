import mongoose from 'mongoose';

const ResponsableSchema = new mongoose.Schema({
  codiRespnsble: String,
  nmbrRespnsble: String,
  email: String,
  telefono: String,
  /** Último correo automático de alertas Complex (recordatorio cada 30 días). */
  fchaUltimoRecordatorioAlertas: Date,
  /** Último correo automático de alertas ANS Express (recordatorio cada 30 días). */
  fchaUltimoRecordatorioAlertasExpress: Date,
  /** Último correo automático de alertas Seguros Alfa (recordatorio cada 30 días). */
  fchaUltimoRecordatorioAlertasAlfa: Date,
  /** Último correo automático de alertas Allias (recordatorio cada 30 días). */
  fchaUltimoRecordatorioAlertasAllias: Date,
  /** Último correo automático de alertas Previsora (recordatorio cada 30 días). */
  fchaUltimoRecordatorioAlertasPrevisora: Date,
}, { collection: 'gsk3cAppresponsable' });

const Responsable = mongoose.model('Responsable', ResponsableSchema);
export default Responsable; 