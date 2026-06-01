// models/Usuario.js
import mongoose from "mongoose";

const UsuarioSchema = new mongoose.Schema({
  nombre:           { type: String, required: true, trim: true },
  correo:           { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:         { type: String, required: true },
  rol:              { type: String, enum: ["admin","soporte","usuario","visualizador"], default: "usuario" },
  celular:          { type: String, trim: true },
  cedula:           { type: String, trim: true },
  fechaNacimiento:  { type: Date },
  foto:             { type: String },
  twoFACode:        { type: String },
  twoFACodeExpires: { type: Date },
  apellido:         { type: String, trim: true },
  // Nuevos campos del perfil
  tipoSangre:       { type: String },
  direccion:        { type: String },
  telefonoFijo:     { type: String },
  celulares:        { type: String },
  correosElectronicos: { type: String },
  empresa:          { type: String },
  fechaIngreso:     { type: Date },
  cargos:           { type: String },
  salario:          { type: Number },
  fechaModificacionSueldo: { type: Date },
  tipoContrato:     { type: String },
  fechaModificacionContrato: { type: Date },
  vencimiento:      { type: Date },
  aportesSalud:     { type: String },
  aportesPension:   { type: String },
  aportesCesantias: { type: String },
  aportesARL:       { type: String },
  aportesCCF:       { type: String },
  evaluacionPeriodoPrueba: { type: String },
  sucursal:         { type: String }
}, {
  timestamps: true
});

export default mongoose.model("Usuario", UsuarioSchema);
