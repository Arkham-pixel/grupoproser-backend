// models/SecurUser.js
import mongoose from "mongoose";

const SecurUserSchema = new mongoose.Schema({
  login: { type: String, required: true, unique: true },
  pswd: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  active: { type: String, default: "Y" },
  mfa: { type: String, default: null },
  // 2FA con app de autenticación (Google/Microsoft Authenticator - TOTP)
  totpSecret: { type: String, default: null },      // secreto definitivo (cuando 2FA está activo)
  totpTempSecret: { type: String, default: null },  // secreto pendiente de confirmar durante la activación
  totpEnabled: { type: Boolean, default: false },
  picture: { type: mongoose.Schema.Types.Buffer },
  foto: { type: String }, // Campo para almacenar la URL de la foto de perfil
  role: { type: String, enum: ["admin","soporte","usuario","visualizador","puertos"], required: true },
  phone: { type: String },
  activationCode: { type: String },
  privAdmin: { type: String, default: "" },
  pswdLastUpdated: { type: String },
  mfaLastUpdated: { type: String, default: null },
  // Campos para recuperación de contraseña
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  cedula: { type: String }, // Campo para la cédula del usuario
  enVacaciones: { type: Boolean, default: false }, // Estado de vacaciones
  // Nuevos campos del perfil
  fechaNacimiento: { type: Date },
  tipoSangre: { type: String },
  direccion: { type: String },
  telefonoFijo: { type: String },
  celulares: { type: String },
  correosElectronicos: { type: String },
  empresa: { type: String },
  fechaIngreso: { type: Date },
  cargos: { type: String },
  salario: { type: Number },
  fechaModificacionSueldo: { type: Date },
  tipoContrato: { type: String },
  fechaModificacionContrato: { type: Date },
  vencimiento: { type: Date },
  aportesSalud: { type: String },
  aportesPension: { type: String },
  aportesCesantias: { type: String },
  aportesARL: { type: String },
  aportesCCF: { type: String },
  evaluacionPeriodoPrueba: { type: String },
  sucursal: { type: String }
}, {
  timestamps: true,
  collection: 'securUsers' // Especificar la colección exacta
});

export default mongoose.model("SecurUser", SecurUserSchema); 