// models/SesionUsuario.js
import mongoose from "mongoose";

const SesionUsuarioSchema = new mongoose.Schema({
  usuarioId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'SecurUser', 
    required: true 
  },
  login: { 
    type: String, 
    required: true 
  },
  nombre: { 
    type: String, 
    required: true 
  },
  inicioSesion: { 
    type: Date, 
    required: true,
    default: Date.now 
  },
  finSesion: { 
    type: Date 
  },
  duracionMinutos: { 
    type: Number 
  },
  duracionSegundos: { 
    type: Number 
  },
  activa: { 
    type: Boolean, 
    default: true 
  },
  ip: { 
    type: String 
  },
  userAgent: { 
    type: String 
  }
}, {
  timestamps: true,
  collection: 'sesionesUsuarios'
});

// Índices para mejorar las consultas
SesionUsuarioSchema.index({ usuarioId: 1, inicioSesion: -1 });
SesionUsuarioSchema.index({ login: 1, inicioSesion: -1 });
SesionUsuarioSchema.index({ activa: 1 });

export default mongoose.model("SesionUsuario", SesionUsuarioSchema);

