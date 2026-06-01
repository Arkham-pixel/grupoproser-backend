import mongoose from 'mongoose';

const CiudadSchema = new mongoose.Schema({
  codiMunicipio: String,    // Código de 5 dígitos (municipio)
  descMunicipio: String,    // Nombre del municipio
  codiDepto: String,        // Código del departamento
  descDepto: String,        // Nombre del departamento
  codiPais: String,         // Código del país
  descPais: String,         // Nombre del país
  codiPoblado: String,      // Código de poblado (legacy)
  descPoblado: String,      // Descripción de poblado (legacy)
  codiCpoblado: String,     // Código de poblado de 8 dígitos (principal)
  descCpoblado: String      // Descripción del poblado
}, { collection: 'gsk3cAppciudades' });

export default mongoose.model('Ciudad', CiudadSchema);
