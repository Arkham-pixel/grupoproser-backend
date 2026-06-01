import mongoose from 'mongoose';

const EstadoExpressSchema = new mongoose.Schema({
  codiEstdo: Number,
  descEstdo: String,
  codiEstado: Number,
  descEstado: String,
}, { collection: 'gsk3cAppestadosExpress' });

const EstadoExpress = mongoose.model('EstadoExpress', EstadoExpressSchema, 'gsk3cAppestadosExpress');

export default EstadoExpress;


