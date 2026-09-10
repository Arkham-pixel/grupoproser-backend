import mongoose from 'mongoose';

const firmaSchema = new mongoose.Schema(
  {
    firmado: { type: Boolean, default: false },
    firmadoEn: { type: Date },
    firmaImagen: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    documentoId: { type: String },
  },
  { _id: false }
);

const docHrSchema = new mongoose.Schema(
  {
    subido: { type: Boolean, default: false },
    subidoEn: { type: Date },
    documentoId: { type: String },
    nombreArchivo: { type: String },
  },
  { _id: false }
);

const OnboardingInvitacionSchema = new mongoose.Schema(
  {
    // Los completa el usuario en el portal (admin solo genera el enlace)
    nombre: { type: String, default: '', trim: true },
    correo: { type: String, default: '', trim: true, lowercase: true },
    celular: { type: String, default: '', trim: true },
    cedula: { type: String, default: '', trim: true },
    fechaNacimiento: { type: Date },
    rol: { type: String, required: true, default: 'usuario' },
    datosCompletos: { type: Boolean, default: false },
    notaAdmin: { type: String, default: '', trim: true },

    tokenHash: { type: String, index: true, sparse: true },
    tokenExpira: { type: Date },

    estado: {
      type: String,
      enum: [
        'pendiente',
        'firmas_parciales',
        'firmado',
        'cuenta_creada',
        'docs_parciales',
        'completado',
        'cancelado',
        'expirado',
      ],
      default: 'pendiente',
      index: true,
    },

    firmaPoliticaDatos: { type: firmaSchema, default: () => ({}) },
    firmaConfidencialidad: { type: firmaSchema, default: () => ({}) },

    usuarioId: { type: String, index: true, sparse: true },
    login: { type: String },

    documentosHr: {
      hojaVida: { type: docHrSchema, default: () => ({}) },
      certificadoBancario: { type: docHrSchema, default: () => ({}) },
      cedula: { type: docHrSchema, default: () => ({}) },
    },

    creadoPor: {
      id: String,
      login: String,
      nombre: String,
    },

    emailEnviado: { type: Boolean, default: false },
    emailEnviadoEn: { type: Date },
    completadoEn: { type: Date },
  },
  {
    timestamps: true,
    collection: 'onboardingInvitaciones',
  }
);

OnboardingInvitacionSchema.index({ correo: 1, estado: 1 });
OnboardingInvitacionSchema.index({ cedula: 1, estado: 1 });

export default mongoose.model('OnboardingInvitacion', OnboardingInvitacionSchema);
