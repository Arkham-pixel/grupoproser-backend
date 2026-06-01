//backend/backend/backend/models/Cliente.js
import mongoose from 'mongoose';

const ClienteSchema = new mongoose.Schema({
  correo: String,
  codiAsgrdra: String,  // Campo correcto según la base de datos
  rzonSocial: String,
  teleFijo: String,     // Campo correcto según la base de datos
  teleCellar: String,   // Campo correcto según la base de datos
  direCliente: String,
  codiPais: String,     // Campo correcto según la base de datos
  codiDepto: String,    // Campo correcto según la base de datos
  codiMpio: String,     // Campo correcto según la base de datos
  codiPoblado: String,  // Campo correcto según la base de datos
  codiEstdo: Number,    // Campo correcto según la base de datos
  descIva: Number,
  reteIva: Number,
  reteFuente: Number,
  reteIca: Number,
}, { collection: 'gsk3cAppcliente' });

export default mongoose.model('Cliente', ClienteSchema);
