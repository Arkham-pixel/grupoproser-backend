import mongoose from 'mongoose';

const FuncionarioSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: true,
    trim: true
  },
  cargo: {
    type: String,
    required: true,
    trim: true
  },
  telefono: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  firma: {
    type: String, // Base64 de la firma
    default: null
  },
  activo: {
    type: Boolean,
    default: true
  },
  fechaCreacion: {
    type: Date,
    default: Date.now
  },
  fechaActualizacion: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Actualizar fechaActualizacion antes de guardar
FuncionarioSchema.pre('save', function(next) {
  this.fechaActualizacion = new Date();
  next();
});

const Funcionario = mongoose.model('Funcionario', FuncionarioSchema);
export default Funcionario;
