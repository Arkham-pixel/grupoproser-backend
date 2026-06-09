import mongoose from 'mongoose';

const matrizRiesgoSchema = new mongoose.Schema({
  // Información básica del formulario
  tipo: {
    type: String,
    required: true,
    enum: ['matriz_riesgo_inicial', 'matriz_riesgo_final'],
    default: 'matriz_riesgo_inicial',
    index: true
  },
  
  titulo: {
    type: String,
    required: true,
    trim: true
  },
  
  // Información de la empresa
  nombreEmpresa: {
    type: String,
    required: true,
    trim: true
  },
  
  // Información del ingeniero de riesgo (usuario logueado)
  ajustador: {
    nombre: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      trim: true
    },
    userId: {
      type: String,
      required: true,
      index: true
    }
  },
  
  // Fecha y hora de creación
  fechaCreacion: {
    type: Date,
    default: Date.now,
    required: true
  },
  
  // Fecha y hora de última modificación
  fechaModificacion: {
    type: Date,
    default: Date.now
  },
  
  // Estado del formulario
  estado: {
    type: String,
    required: true,
    enum: ['inicial', 'final', 'en_proceso', 'completado'],
    default: 'inicial'
  },
  
  // Datos de la matriz de riesgo (estructura completa)
  datosMatriz: {
    // Sección de información
    informacion: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    
    // Sección de identificación de riesgos
    identificacion: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    
    // Sección de valoración de riesgos
    valoracion: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    
    // Sección de mapa de calor
    mapaCalor: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    
    // Sección de gestión de riesgos (planes de acción)
    gestionRiesgos: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  
  // Archivo generado (si se ha exportado)
  archivo: {
    nombre: String,
    ruta: String,
    tamaño: Number,
    tipoMime: String,
    fechaGeneracion: Date
  },
  
  // Metadata del sistema
  metadata: {
    version: {
      type: String,
      default: '1.0'
    },
    navegador: String,
    sistemaOperativo: String,
    ip: String,
    userAgent: String
  },
  
  // Referencia al formulario inicial (si es una actualización)
  formularioInicial: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MatrizRiesgo',
    default: null
  },
  
  // Historial de cambios
  historialCambios: [{
    fecha: {
      type: Date,
      default: Date.now
    },
    usuario: String,
    accion: String,
    descripcion: String,
    cambios: mongoose.Schema.Types.Mixed
  }],
  
  // Soft delete
  eliminado: {
    type: Boolean,
    default: false
  },
  
  fechaEliminacion: Date,
  usuarioEliminacion: String
  
}, {
  timestamps: true,
  collection: 'matrices_riesgo'
});

// Índices para mejorar el rendimiento
matrizRiesgoSchema.index({ tipo: 1, estado: 1 });
matrizRiesgoSchema.index({ 'ajustador.userId': 1, fechaCreacion: -1 });
matrizRiesgoSchema.index({ nombreEmpresa: 1, fechaCreacion: -1 });
matrizRiesgoSchema.index({ formularioInicial: 1 });

// Middleware para actualizar fechaModificacion
matrizRiesgoSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.fechaModificacion = new Date();
  }
  next();
});

// Método para agregar entrada al historial
matrizRiesgoSchema.methods.agregarHistorial = function(usuario, accion, descripcion, cambios = {}) {
  this.historialCambios.push({
    fecha: new Date(),
    usuario,
    accion,
    descripcion,
    cambios
  });
  return this.save();
};

// Método para marcar como eliminado
matrizRiesgoSchema.methods.marcarEliminado = function(usuario) {
  this.eliminado = true;
  this.fechaEliminacion = new Date();
  this.usuarioEliminacion = usuario;
  return this.save();
};

export default mongoose.model('MatrizRiesgo', matrizRiesgoSchema);
