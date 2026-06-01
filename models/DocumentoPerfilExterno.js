import mongoose from 'mongoose';

const DocumentoPerfilExternoSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: true,
      trim: true
    },
    cedula: {
      type: String,
      trim: true,
      default: ''
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    telefono: {
      type: String,
      trim: true,
      default: ''
    },
    telefonoFijo: {
      type: String,
      trim: true,
      default: ''
    },
    celulares: {
      type: String,
      trim: true,
      default: ''
    },
    empresa: {
      type: String,
      trim: true,
      default: ''
    },
    cargo: {
      type: String,
      trim: true,
      default: ''
    },
    sucursal: {
      type: String,
      trim: true,
      default: ''
    },
    fechaNacimiento: {
      type: Date,
      default: null
    },
    tipoSangre: {
      type: String,
      trim: true,
      default: ''
    },
    direccion: {
      type: String,
      trim: true,
      default: ''
    },
    fechaIngreso: {
      type: Date,
      default: null
    },
    salario: {
      type: Number,
      default: null
    },
    fechaModificacionSueldo: {
      type: Date,
      default: null
    },
    tipoContrato: {
      type: String,
      trim: true,
      default: ''
    },
    fechaModificacionContrato: {
      type: Date,
      default: null
    },
    vencimiento: {
      type: Date,
      default: null
    },
    aportesSalud: {
      type: String,
      trim: true,
      default: ''
    },
    aportesPension: {
      type: String,
      trim: true,
      default: ''
    },
    aportesCesantias: {
      type: String,
      trim: true,
      default: ''
    },
    aportesARL: {
      type: String,
      trim: true,
      default: ''
    },
    aportesCCF: {
      type: String,
      trim: true,
      default: ''
    },
    evaluacionPeriodoPrueba: {
      type: String,
      trim: true,
      default: ''
    },
    activo: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    collection: 'documentoPerfilesExternos'
  }
);

export default mongoose.model('DocumentoPerfilExterno', DocumentoPerfilExternoSchema);
