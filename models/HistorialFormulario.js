import mongoose from 'mongoose';

const historialFormularioSchema = new mongoose.Schema({
  // Información básica del formulario
  tipo: {
    type: String,
    required: true,
    enum: ['complex', 'riesgos', 'pol', 'inspeccion', 'inspeccion-propiedades', 'inspeccion-puertos', 'acta_inspeccion', 'maquinaria', 'siniestros', 'ajuste', 'ajuste_inicial', 'ajuste_preeliminar', 'ajuste_actualizacion', 'ajuste_informeFinal', 'matriz_riesgo_inicial', 'matriz_riesgo_final'],
    index: true
  },
  
  titulo: {
    type: String,
    required: true,
    trim: true
  },
  
  // Sistema de carpetas por caso
  casoId: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  
  numeroCaso: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  
  carpetaCaso: {
    type: String,
    required: true,
    trim: true
  },
  
  // Información del usuario que creó el formulario
  usuario: {
    type: String,
    required: true,
    trim: true
  },
  
  nombreUsuario: {
    type: String,
    required: true,
    trim: true
  },
  
  userId: {
    type: String,
    required: true,
    index: true
  },
  
  // Estado del flujo de versiones del informe de ajuste (inicial → actualización → final)
  estadoActual: {
    type: String,
    trim: true,
    default: 'inicial'
  },
  
  // Estado del formulario
  estado: {
    type: String,
    required: true,
    enum: ['completado', 'en_proceso', 'pendiente', 'borrador', 'generado'],
    default: 'completado'
  },
  
  // Archivo generado
  archivo: {
    nombre: {
      type: String,
      required: true
    },
    ruta: {
      type: String,
      required: true
    },
    tamaño: Number,
    tipoMime: String
  },
  
  // Datos del formulario (estructura flexible)
  datos: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  
  // Metadata del sistema
  metadata: {
    version: {
      type: String,
      default: '1.0'
    },
    creadoPor: {
      type: String,
      required: true
    },
    modificadoPor: {
      type: String,
      required: true
    },
    tags: [String],
    categoria: String,
    prioridad: {
      type: String,
      enum: ['baja', 'media', 'alta', 'urgente'],
      default: 'media'
    }
  },
  
  // Fechas importantes
  fechaCreacion: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  fechaModificacion: {
    type: Date,
    default: Date.now
  },
  
  fechaVencimiento: Date,
  
  // Información de auditoría
  auditoria: {
    ipCreacion: String,
    userAgentCreacion: String,
    ipModificacion: String,
    userAgentModificacion: String,
    cambios: [{
      campo: String,
      valorAnterior: mongoose.Schema.Types.Mixed,
      valorNuevo: mongoose.Schema.Types.Mixed,
      fecha: {
        type: Date,
        default: Date.now
      },
      usuario: String
    }]
  },
  
  // Configuración de privacidad y acceso
  privacidad: {
    esPublico: {
      type: Boolean,
      default: false
    },
    usuariosAutorizados: [String],
    gruposAutorizados: [String]
  },
  
  // Información de versionado
  versiones: [{
    numero: Number,
    fecha: {
      type: Date,
      default: Date.now
    },
    usuario: String,
    cambios: String,
    datos: mongoose.Schema.Types.Mixed
  }],
  
  // Comentarios y notas
  comentarios: [{
    usuario: String,
    fecha: {
      type: Date,
      default: Date.now
    },
    texto: String,
    tipo: {
      type: String,
      enum: ['general', 'revision', 'aprobacion', 'rechazo'],
      default: 'general'
    }
  }],

  // Secuencia de trazabilidad por número de ajuste (ADITIVO, no reemplaza trazabilidad existente)
  trazabilidadSecuencia: {
    numeroAjuste: {
      type: String,
      trim: true,
      index: true
    },
    pasos: {
      inspeccion: {
        orden: { type: Number, default: 0 },
        tipoVersion: { type: String, default: 'inspeccion' },
        formularioId: String,
        documentoNombre: String,
        documentoRuta: String,
        pdfNombre: String,
        pdfRuta: String,
        fecha: Date,
        usuario: String
      },
      preliminar: {
        orden: { type: Number, default: 1 },
        tipoVersion: { type: String, default: 'preliminar' },
        formularioId: String,
        documentoNombre: String,
        documentoRuta: String,
        pdfNombre: String,
        pdfRuta: String,
        fecha: Date,
        usuario: String
      },
      actualizacion: {
        orden: { type: Number, default: 2 },
        tipoVersion: { type: String, default: 'actualizacion' },
        formularioId: String,
        documentoNombre: String,
        documentoRuta: String,
        pdfNombre: String,
        pdfRuta: String,
        fecha: Date,
        usuario: String
      },
      final: {
        orden: { type: Number, default: 3 },
        tipoVersion: { type: String, default: 'final' },
        formularioId: String,
        documentoNombre: String,
        documentoRuta: String,
        pdfNombre: String,
        pdfRuta: String,
        fecha: Date,
        usuario: String
      }
    }
  },
  
  // Estado de archivo
  archivado: {
    type: Boolean,
    default: false
  },
  
  fechaArchivado: Date,
  
  // Soft delete
  eliminado: {
    type: Boolean,
    default: false
  },
  
  fechaEliminacion: Date,
  
  usuarioEliminacion: String
}, {
  timestamps: true,
  collection: 'historial_formularios'
});

// Índices para mejorar el rendimiento de las consultas
historialFormularioSchema.index({ tipo: 1, estado: 1 });
historialFormularioSchema.index({ usuario: 1, fechaCreacion: -1 });
historialFormularioSchema.index({ fechaCreacion: -1 });
historialFormularioSchema.index({ 'datos.actaNumero': 1 });
historialFormularioSchema.index({ 'datos.numeroAjuste': 1 });
historialFormularioSchema.index({ 'datos.casoNumero': 1 });

// Nuevos índices para el sistema de carpetas por caso
historialFormularioSchema.index({ casoId: 1, tipo: 1 });
historialFormularioSchema.index({ numeroCaso: 1, fechaCreacion: -1 });
historialFormularioSchema.index({ carpetaCaso: 1, fechaCreacion: -1 });

// Middleware para actualizar fechaModificacion automáticamente
historialFormularioSchema.pre('save', function(next) {
  this.fechaModificacion = new Date();
  next();
});

// Middleware para soft delete
historialFormularioSchema.pre('find', function() {
  this.where({ eliminado: { $ne: true } });
});

historialFormularioSchema.pre('findOne', function() {
  this.where({ eliminado: { $ne: true } });
});

// Métodos estáticos
historialFormularioSchema.statics.buscarPorTexto = function(texto) {
  return this.find({
    $or: [
      { titulo: { $regex: texto, $options: 'i' } },
      { usuario: { $regex: texto, $options: 'i' } },
      { 'datos.actaNumero': { $regex: texto, $options: 'i' } },
      { 'datos.numeroAjuste': { $regex: texto, $options: 'i' } },
      { 'datos.casoNumero': { $regex: texto, $options: 'i' } }
    ],
    eliminado: { $ne: true }
  }).sort({ fechaCreacion: -1 });
};

historialFormularioSchema.statics.obtenerEstadisticas = function() {
  return this.aggregate([
    { $match: { eliminado: { $ne: true } } },
    {
      $group: {
        _id: '$tipo',
        total: { $sum: 1 },
        completados: {
          $sum: { $cond: [{ $eq: ['$estado', 'completado'] }, 1, 0] }
        },
        enProceso: {
          $sum: { $cond: [{ $eq: ['$estado', 'en_proceso'] }, 1, 0] }
        },
        pendientes: {
          $sum: { $cond: [{ $eq: ['$estado', 'pendiente'] }, 1, 0] }
        }
      }
    }
  ]);
};

// Método para obtener casos organizados por carpeta
historialFormularioSchema.statics.obtenerCasosOrganizados = function() {
  return this.aggregate([
    { $match: { eliminado: { $ne: true } } },
    {
      $group: {
        _id: {
          casoId: '$casoId',
          numeroCaso: '$numeroCaso',
          carpetaCaso: '$carpetaCaso'
        },
        totalFormularios: { $sum: 1 },
        tipos: { $addToSet: '$tipo' },
        usuarios: { $addToSet: '$nombreUsuario' },
        fechaCreacion: { $min: '$fechaCreacion' },
        fechaModificacion: { $max: '$fechaModificacion' },
        formularios: {
          $push: {
            _id: '$_id',
            tipo: '$tipo',
            titulo: '$titulo',
            estado: '$estado',
            nombreUsuario: '$nombreUsuario',
            fechaCreacion: '$fechaCreacion',
            fechaModificacion: '$fechaModificacion'
          }
        }
      }
    },
    {
      $sort: { 'fechaModificacion': -1 }
    }
  ]);
};

// Método para obtener formularios de un caso específico
historialFormularioSchema.statics.obtenerFormulariosPorCaso = function(casoId) {
  return this.find({ 
    casoId: casoId, 
    eliminado: { $ne: true } 
  }).sort({ fechaCreacion: -1 });
};

// Métodos de instancia
historialFormularioSchema.methods.agregarComentario = function(usuario, texto, tipo = 'general') {
  this.comentarios.push({
    usuario,
    texto,
    tipo,
    fecha: new Date()
  });
  return this.save();
};

historialFormularioSchema.methods.crearVersion = function(usuario, cambios, datos) {
  const versionActual = this.versiones.length + 1;
  this.versiones.push({
    numero: versionActual,
    usuario,
    cambios,
    datos: JSON.parse(JSON.stringify(datos)),
    fecha: new Date()
  });
  return this.save();
};

historialFormularioSchema.methods.archivar = function() {
  this.archivado = true;
  this.fechaArchivado = new Date();
  return this.save();
};

historialFormularioSchema.methods.softDelete = function(usuario) {
  this.eliminado = true;
  this.fechaEliminacion = new Date();
  this.usuarioEliminacion = usuario;
  return this.save();
};

// Virtual para obtener la URL de descarga
historialFormularioSchema.virtual('urlDescarga').get(function() {
  return `/api/historial-formularios/${this._id}/descargar`;
});

// Configurar toJSON para incluir virtuals
historialFormularioSchema.set('toJSON', { virtuals: true });
historialFormularioSchema.set('toObject', { virtuals: true });

export default mongoose.model('HistorialFormulario', historialFormularioSchema);
