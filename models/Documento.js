import mongoose from "mongoose";

const documentoSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: true,
    trim: true
  },
  descripcion: {
    type: String,
    trim: true,
    default: ""
  },
  archivo: {
    nombreOriginal: {
      type: String,
      required: true
    },
    nombreArchivo: {
      type: String,
      required: true
    },
    ruta: {
      type: String,
      required: true
    },
    tamaño: {
      type: Number,
      required: true
    },
    tipoMime: {
      type: String,
      required: true
    }
  },
  usuarioSubio: {
    id: {
      type: String,
      required: true
    },
    login: {
      type: String,
      required: true
    },
    nombre: {
      type: String,
      required: true
    }
  },
  etiquetas: [{
    type: String,
    trim: true
  }],
  fechaSubida: {
    type: Date,
    default: Date.now
  },
  fechaModificacion: {
    type: Date,
    default: Date.now
  },
  activo: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Índices para búsqueda rápida
documentoSchema.index({ nombre: 'text', descripcion: 'text', etiquetas: 'text' });
documentoSchema.index({ usuarioSubio: { id: 1, login: 1 } });
documentoSchema.index({ fechaSubida: -1 });
documentoSchema.index({ activo: 1 });

export default mongoose.model("Documento", documentoSchema);

